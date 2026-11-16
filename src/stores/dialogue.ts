import { defineStore } from "pinia";
import { invoke } from "@tauri-apps/api/core";
import type { DialogueLine, DialogueRole, TtsParams } from "../types";
import {
  DEFAULT_CAST_PRESETS,
  INITIAL_ROLES,
  SAMPLE_DIALOGUE_SCRIPT,
} from "../constants/dialoguePresets";
import { parseScript } from "../utils/dialogueParser";
import {
  concatUint8Arrays,
  generateSilentMp3Bytes,
  msToSrtTime,
  msToVttTime,
} from "../utils/audioConcat";
import { useDictionaryStore } from "./dictionary";
import { toErrorMessage } from "../utils/ttsErrors";

const ROLES_STORAGE_KEY = "tts_dialogue_roles_v1";
const EDGE_TTS_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
// 48kbps mono MP3 is 6000 bytes per second (6 bytes per millisecond)
const BYTES_PER_MS = 48000 / 8 / 1000;

function loadInitialRoles(): DialogueRole[] {
  try {
    const saved = localStorage.getItem(ROLES_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // Ignore invalid JSON
  }
  return INITIAL_ROLES;
}

function saveRolesToStorage(roles: DialogueRole[]): void {
  try {
    localStorage.setItem(ROLES_STORAGE_KEY, JSON.stringify(roles));
  } catch {
    // Ignore storage errors
  }
}

interface DialogueState {
  roles: DialogueRole[];
  lines: DialogueLine[];
  defaultPauseMs: number;
  synthesizing: boolean;
  stopRequested: boolean;
  progress: {
    current: number;
    total: number;
    lineText: string;
    roleName: string;
  };
  audioUrl: string | null;
  audioBytes: Uint8Array | null;
  subtitles: { srt: string; vtt: string } | null;
  auditioningLineId: string | null;
  errorMessage: string | null;
}

let activeAuditionAudio: HTMLAudioElement | null = null;

export const useDialogueStore = defineStore("dialogue", {
  state: (): DialogueState => {
    const roles = loadInitialRoles();
    const lines = parseScript(SAMPLE_DIALOGUE_SCRIPT, roles);

    return {
      roles,
      lines,
      defaultPauseMs: 300,
      synthesizing: false,
      stopRequested: false,
      progress: {
        current: 0,
        total: 0,
        lineText: "",
        roleName: "",
      },
      audioUrl: null,
      audioBytes: null,
      subtitles: null,
      auditioningLineId: null,
      errorMessage: null,
    };
  },

  actions: {
    applyPreset(presetId: string) {
      const preset = DEFAULT_CAST_PRESETS.find((p) => p.id === presetId);
      if (!preset) {
        return;
      }

      this.roles = JSON.parse(JSON.stringify(preset.roles));
      saveRolesToStorage(this.roles);

      // Re-map line roles if old role ID no longer exists
      const fallbackRoleId = this.roles.find((r) => r.isDefault)?.id || this.roles[0]?.id || "";
      const validRoleIds = new Set(this.roles.map((r) => r.id));

      this.lines.forEach((line) => {
        if (!validRoleIds.has(line.roleId)) {
          line.roleId = fallbackRoleId;
        }
      });
    },

    addRole(newRole: Omit<DialogueRole, "id">) {
      const role: DialogueRole = {
        ...newRole,
        id: crypto.randomUUID(),
      };
      this.roles.push(role);
      saveRolesToStorage(this.roles);
    },

    updateRole(id: string, patch: Partial<DialogueRole>) {
      const index = this.roles.findIndex((r) => r.id === id);
      if (index !== -1) {
        this.roles[index] = { ...this.roles[index], ...patch };
        saveRolesToStorage(this.roles);
      }
    },

    removeRole(id: string) {
      if (this.roles.length <= 1) {
        return;
      }

      this.roles = this.roles.filter((r) => r.id !== id);
      saveRolesToStorage(this.roles);

      const fallbackRoleId = this.roles.find((r) => r.isDefault)?.id || this.roles[0]?.id || "";
      this.lines.forEach((line) => {
        if (line.roleId === id) {
          line.roleId = fallbackRoleId;
        }
      });
    },

    addLine(roleId?: string, text = "", pauseAfterMs?: number) {
      const assignedRoleId =
        roleId || this.roles.find((r) => r.isDefault)?.id || this.roles[0]?.id || "";
      this.lines.push({
        id: crypto.randomUUID(),
        roleId: assignedRoleId,
        text,
        pauseAfterMs: pauseAfterMs ?? this.defaultPauseMs,
      });
    },

    insertLineAfter(index: number, roleId?: string, text = "") {
      const assignedRoleId =
        roleId || this.roles.find((r) => r.isDefault)?.id || this.roles[0]?.id || "";
      const newLine: DialogueLine = {
        id: crypto.randomUUID(),
        roleId: assignedRoleId,
        text,
        pauseAfterMs: this.defaultPauseMs,
      };
      this.lines.splice(index + 1, 0, newLine);
    },

    updateLine(id: string, patch: Partial<DialogueLine>) {
      const index = this.lines.findIndex((l) => l.id === id);
      if (index !== -1) {
        this.lines[index] = { ...this.lines[index], ...patch };
      }
    },

    removeLine(id: string) {
      this.lines = this.lines.filter((l) => l.id !== id);
    },

    clearLines() {
      this.lines = [];
    },

    parseScriptText(text: string, mode: "prefix" | "quotes" = "prefix") {
      const parsed = parseScript(text, this.roles, {
        mode,
        pauseMs: this.defaultPauseMs,
      });
      if (parsed.length > 0) {
        this.lines = parsed;
      }
    },

    async auditionLine(lineId: string): Promise<void> {
      const line = this.lines.find((l) => l.id === lineId);
      if (!line || !line.text.trim()) {
        return;
      }

      const role = this.roles.find((r) => r.id === line.roleId) || this.roles[0];
      if (!role) {
        return;
      }

      if (activeAuditionAudio) {
        activeAuditionAudio.pause();
        activeAuditionAudio = null;
      }

      this.auditioningLineId = lineId;

      try {
        const dictStore = useDictionaryStore();
        const speechText = dictStore.applyDictionary(line.text);

        const params: TtsParams = {
          text: speechText,
          voice: role.voice,
          rate: `${role.rate >= 0 ? "+" : ""}${role.rate}%`,
          pitch: `${role.pitch >= 0 ? "+" : ""}${role.pitch}Hz`,
          volume: `${role.volume >= 0 ? "+" : ""}${role.volume}%`,
          format: EDGE_TTS_FORMAT,
          task_id: crypto.randomUUID(),
          max_retries: 2,
          chunk_concurrency: 1,
        };

        const buffer = await invoke<ArrayBuffer>("tts_convert", { params });
        const blob = new Blob([buffer], { type: "audio/mp3" });
        const url = URL.createObjectURL(blob);

        const audio = new Audio(url);
        activeAuditionAudio = audio;
        audio.onended = () => {
          if (this.auditioningLineId === lineId) {
            this.auditioningLineId = null;
          }
          URL.revokeObjectURL(url);
        };
        audio.onerror = () => {
          this.auditioningLineId = null;
          URL.revokeObjectURL(url);
        };
        await audio.play();
      } catch (err) {
        this.auditioningLineId = null;
        this.errorMessage = toErrorMessage(err);
      }
    },

    stopSynthesis() {
      this.stopRequested = true;
      this.synthesizing = false;
    },

    async synthesizeAll(): Promise<void> {
      if (this.synthesizing || this.lines.length === 0) {
        return;
      }

      this.synthesizing = true;
      this.stopRequested = false;
      this.errorMessage = null;

      if (this.audioUrl) {
        URL.revokeObjectURL(this.audioUrl);
        this.audioUrl = null;
        this.audioBytes = null;
        this.subtitles = null;
      }

      const dictStore = useDictionaryStore();
      const chunks: Uint8Array[] = [];
      const srtCues: Array<{ index: number; startMs: number; endMs: number; text: string }> = [];
      let currentTimelineMs = 0;

      try {
        for (let i = 0; i < this.lines.length; i++) {
          if (this.stopRequested) {
            break;
          }

          const line = this.lines[i];
          const role = this.roles.find((r) => r.id === line.roleId) || this.roles[0];
          const roleName = role ? role.name : "旁白";

          this.progress = {
            current: i + 1,
            total: this.lines.length,
            lineText: line.text,
            roleName,
          };

          const speechText = dictStore.applyDictionary(line.text);
          if (!speechText.trim()) {
            continue;
          }

          const params: TtsParams = {
            text: speechText,
            voice: role.voice,
            rate: `${role.rate >= 0 ? "+" : ""}${role.rate}%`,
            pitch: `${role.pitch >= 0 ? "+" : ""}${role.pitch}Hz`,
            volume: `${role.volume >= 0 ? "+" : ""}${role.volume}%`,
            format: EDGE_TTS_FORMAT,
            task_id: crypto.randomUUID(),
            max_retries: 3,
            chunk_concurrency: 1,
          };

          const buffer = await invoke<ArrayBuffer>("tts_convert", { params });
          if (this.stopRequested) {
            break;
          }

          const audioChunk = new Uint8Array(buffer);
          chunks.push(audioChunk);

          // Estimate duration in ms based on standard 48kbps bitrate
          const lineDurationMs = Math.max(100, Math.round(audioChunk.length / BYTES_PER_MS));
          const lineStartMs = currentTimelineMs;
          const lineEndMs = lineStartMs + lineDurationMs;

          srtCues.push({
            index: srtCues.length + 1,
            startMs: lineStartMs,
            endMs: lineEndMs,
            text: `[${roleName}] ${line.text}`,
          });

          currentTimelineMs = lineEndMs;

          // Append silence gap if pauseAfterMs > 0
          const pauseMs = line.pauseAfterMs ?? this.defaultPauseMs;
          if (pauseMs > 0 && i < this.lines.length - 1) {
            const silentChunk = generateSilentMp3Bytes(pauseMs);
            chunks.push(silentChunk);
            currentTimelineMs += pauseMs;
          }
        }

        if (this.stopRequested || chunks.length === 0) {
          return;
        }

        const combinedAudio = concatUint8Arrays(chunks);
        this.audioBytes = combinedAudio;
        const blob = new Blob([combinedAudio.buffer as ArrayBuffer], { type: "audio/mp3" });
        this.audioUrl = URL.createObjectURL(blob);

        // Build SRT & VTT subtitles
        const srtContent = srtCues
          .map(
            (c) => `${c.index}\n${msToSrtTime(c.startMs)} --> ${msToSrtTime(c.endMs)}\n${c.text}\n`,
          )
          .join("\n");

        const vttContent = `WEBVTT\n\n${srtCues
          .map(
            (c) => `${c.index}\n${msToVttTime(c.startMs)} --> ${msToVttTime(c.endMs)}\n${c.text}\n`,
          )
          .join("\n")}`;

        this.subtitles = {
          srt: srtContent,
          vtt: vttContent,
        };
      } catch (err) {
        this.errorMessage = toErrorMessage(err);
      } finally {
        this.synthesizing = false;
        this.stopRequested = false;
      }
    },
  },
});
