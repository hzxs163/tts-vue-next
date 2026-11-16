import { defineStore } from "pinia";
import { invoke } from "@tauri-apps/api/core";
import type { DialogueLine, DialogueRole, SubtitleCue, TtsParams } from "../types";
import {
  DEFAULT_CAST_PRESETS,
  INITIAL_ROLES,
  SAMPLE_DIALOGUE_SCRIPT,
} from "../constants/dialoguePresets";
import { parseScript } from "../utils/dialogueParser";
import { concatUint8Arrays, generateSilentMp3Bytes } from "../utils/audioConcat";
import { cuesToSrt, cuesToVtt, shiftCues } from "../utils/subtitles";
import { useDictionaryStore } from "./dictionary";
import { toErrorMessage } from "../utils/ttsErrors";

const ROLES_STORAGE_KEY = "tts_dialogue_roles_v1";
const LINES_STORAGE_KEY = "tts_dialogue_lines_v1";
const EDGE_TTS_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
// 48kbps mono MP3 is 6000 bytes per second (6 bytes per millisecond)
const BYTES_PER_MS = 48000 / 8 / 1000;

function normalizeRoleName(name: string): string {
  return name.trim().toLowerCase();
}

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

function loadInitialLines(): DialogueLine[] {
  try {
    const saved = localStorage.getItem(LINES_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // Ignore invalid JSON
  }
  return [];
}

function saveLinesToStorage(lines: DialogueLine[]): void {
  try {
    localStorage.setItem(LINES_STORAGE_KEY, JSON.stringify(lines));
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
  currentTaskId: string | null;
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
  /** Ids of the lines whose synthesis failed during the last run. */
  failedLineIds: string[];
}

let activeAuditionAudio: HTMLAudioElement | null = null;
let activeAuditionUrl: string | null = null;

function releaseAuditionAudio(): void {
  if (activeAuditionAudio) {
    activeAuditionAudio.pause();
    activeAuditionAudio.src = "";
    activeAuditionAudio = null;
  }
  if (activeAuditionUrl) {
    URL.revokeObjectURL(activeAuditionUrl);
    activeAuditionUrl = null;
  }
}

/** Result of a script import attempt. */
export interface ParseScriptResult {
  ok: boolean;
  count: number;
}

export const useDialogueStore = defineStore("dialogue", {
  state: (): DialogueState => {
    const roles = loadInitialRoles();
    const storedLines = loadInitialLines();
    const lines = storedLines.length > 0 ? storedLines : parseScript(SAMPLE_DIALOGUE_SCRIPT, roles);

    return {
      roles,
      lines,
      defaultPauseMs: 300,
      synthesizing: false,
      stopRequested: false,
      currentTaskId: null,
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
      failedLineIds: [],
    };
  },

  getters: {
    failedLines(state): DialogueLine[] {
      return state.lines.filter((line) => state.failedLineIds.includes(line.id));
    },
  },

  actions: {
    /**
     * Applies a cast preset without destroying existing work.
     *
     * Roles are matched by name: a role that already exists keeps its id (so
     * scripted lines stay bound to it) and only gets the preset's voice
     * characteristics. Roles the user created themselves are never removed.
     */
    applyPreset(presetId: string) {
      const preset = DEFAULT_CAST_PRESETS.find((p) => p.id === presetId);
      if (!preset) {
        return;
      }

      const usedIds = new Set(this.roles.map((role) => role.id));

      for (const presetRole of preset.roles) {
        const existing = this.roles.find(
          (role) => normalizeRoleName(role.name) === normalizeRoleName(presetRole.name),
        );

        if (existing) {
          existing.voice = presetRole.voice;
          existing.rate = presetRole.rate;
          existing.pitch = presetRole.pitch;
          existing.volume = presetRole.volume;
          existing.color = presetRole.color;
          continue;
        }

        const id = usedIds.has(presetRole.id) ? crypto.randomUUID() : presetRole.id;
        usedIds.add(id);
        this.roles.push({ ...presetRole, id });
      }

      // Exactly one default role, matching the preset.
      const presetDefault = preset.roles.find((role) => role.isDefault);
      const defaultRole = presetDefault
        ? this.roles.find(
            (role) => normalizeRoleName(role.name) === normalizeRoleName(presetDefault.name),
          )
        : undefined;

      for (const role of this.roles) {
        role.isDefault = role === defaultRole;
      }

      saveRolesToStorage(this.roles);
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
      saveLinesToStorage(this.lines);
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
      saveLinesToStorage(this.lines);
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
      saveLinesToStorage(this.lines);
    },

    updateLine(id: string, patch: Partial<DialogueLine>) {
      const index = this.lines.findIndex((l) => l.id === id);
      if (index !== -1) {
        this.lines[index] = { ...this.lines[index], ...patch };
        saveLinesToStorage(this.lines);
      }
    },

    removeLine(id: string) {
      this.lines = this.lines.filter((l) => l.id !== id);
      saveLinesToStorage(this.lines);
    },

    clearLines() {
      this.lines = [];
      this.failedLineIds = [];
      saveLinesToStorage(this.lines);
    },

    /** Sets the pause that newly added lines start with. */
    setDefaultPause(ms: number) {
      this.defaultPauseMs = Math.max(0, Math.min(5000, Math.round(ms)));
    },

    /**
     * Replaces the script with the parsed lines.
     *
     * Returns the number of parsed lines so the caller can report an empty
     * import instead of silently keeping the previous script.
     */
    parseScriptText(text: string, mode: "prefix" | "quotes" = "prefix"): ParseScriptResult {
      const parsed = parseScript(text, this.roles, {
        mode,
        pauseMs: this.defaultPauseMs,
      });

      if (parsed.length === 0) {
        return { ok: false, count: 0 };
      }

      this.lines = parsed;
      this.failedLineIds = [];
      saveLinesToStorage(this.lines);
      return { ok: true, count: parsed.length };
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

      releaseAuditionAudio();
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
        activeAuditionUrl = url;
        audio.onended = () => {
          if (this.auditioningLineId === lineId) {
            this.auditioningLineId = null;
          }
          releaseAuditionAudio();
        };
        audio.onerror = () => {
          this.auditioningLineId = null;
          releaseAuditionAudio();
        };
        await audio.play();
      } catch (err) {
        this.auditioningLineId = null;
        releaseAuditionAudio();
        this.errorMessage = toErrorMessage(err);
      }
    },

    stopAudition() {
      releaseAuditionAudio();
      this.auditioningLineId = null;
    },

    /**
     * Requests the backend to abort the running synthesis.
     *
     * The frontend loop stops on its own as well, but the backend keeps
     * working on the current line until the request arrives.
     */
    stopSynthesis() {
      this.stopRequested = true;
      this.synthesizing = false;

      const taskId = this.currentTaskId;
      if (taskId) {
        void invoke("tts_stop", { taskId }).catch(() => undefined);
      }
    },

    async synthesizeAll(): Promise<void> {
      if (this.synthesizing || this.lines.length === 0) {
        return;
      }

      this.synthesizing = true;
      this.stopRequested = false;
      this.errorMessage = null;
      this.failedLineIds = [];

      if (this.audioUrl) {
        URL.revokeObjectURL(this.audioUrl);
        this.audioUrl = null;
        this.audioBytes = null;
        this.subtitles = null;
      }

      const dictStore = useDictionaryStore();
      const chunks: Uint8Array[] = [];
      const allCues: SubtitleCue[] = [];
      const errors: string[] = [];
      let currentTimelineMs = 0;

      try {
        for (let i = 0; i < this.lines.length; i++) {
          if (this.stopRequested) {
            break;
          }

          const line = this.lines[i];
          const role = this.roles.find((r) => r.id === line.roleId) || this.roles[0];
          const roleName = role ? role.name : "";

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

          const taskId = crypto.randomUUID();
          this.currentTaskId = taskId;

          const rate = role?.rate ?? 0;
          const pitch = role?.pitch ?? 0;
          const volume = role?.volume ?? 0;

          const params: TtsParams = {
            text: speechText,
            voice: role?.voice ?? "",
            rate: `${rate >= 0 ? "+" : ""}${rate}%`,
            pitch: `${pitch >= 0 ? "+" : ""}${pitch}Hz`,
            volume: `${volume >= 0 ? "+" : ""}${volume}%`,
            format: EDGE_TTS_FORMAT,
            task_id: taskId,
            max_retries: 3,
            chunk_concurrency: 1,
          };

          let audioChunk: Uint8Array;
          try {
            const buffer = await invoke<ArrayBuffer>("tts_convert", { params });
            audioChunk = new Uint8Array(buffer);
          } catch (err) {
            // One broken line must not abort the whole production: remember
            // the failure and continue with the next line.
            this.failedLineIds.push(line.id);
            errors.push(toErrorMessage(err));
            continue;
          }

          if (this.stopRequested) {
            break;
          }

          // The backend reports the real word timings of the line, which is
          // far more accurate than deriving the duration from the byte size.
          const track = await this.fetchLineSubtitles(taskId);
          const lineCues = track?.cues ?? [];
          const lineDurationMs = lineCues.length
            ? Math.max(...lineCues.map((cue) => cue.endMs))
            : Math.max(100, Math.round(audioChunk.length / BYTES_PER_MS));

          const lineStartMs = currentTimelineMs;
          const shifted = shiftCues(lineCues, lineStartMs);

          if (shifted.length === 0) {
            shifted.push({
              offset: lineStartMs * 10000,
              duration: lineDurationMs * 10000,
              startMs: lineStartMs,
              endMs: lineStartMs + lineDurationMs,
              text: `[${roleName}] ${line.text}`,
            });
          } else {
            // The speaker is named once per line, not once per sentence.
            shifted[0] = { ...shifted[0], text: `[${roleName}] ${shifted[0].text}` };
          }

          allCues.push(...shifted);
          chunks.push(audioChunk);
          currentTimelineMs = lineStartMs + lineDurationMs;

          const pauseMs = line.pauseAfterMs ?? this.defaultPauseMs;
          if (pauseMs > 0 && i < this.lines.length - 1) {
            chunks.push(generateSilentMp3Bytes(pauseMs));
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

        this.subtitles = {
          srt: cuesToSrt(allCues),
          vtt: cuesToVtt(allCues),
        };

        if (errors.length > 0) {
          this.errorMessage = errors[0];
        }
      } catch (err) {
        this.errorMessage = toErrorMessage(err);
      } finally {
        this.synthesizing = false;
        this.stopRequested = false;
        this.currentTaskId = null;
      }
    },

    /**
     * Fetches the subtitle track of a single synthesized line.
     *
     * The track is retrieved with an explicit command rather than an event so
     * the timing data can never be lost to a delivery order race.
     */
    async fetchLineSubtitles(
      taskId: string,
    ): Promise<{ srt: string; vtt: string; cues: SubtitleCue[] } | null> {
      try {
        return await invoke<{ srt: string; vtt: string; cues: SubtitleCue[] } | null>(
          "tts_get_subtitles",
          { taskId },
        );
      } catch {
        return null;
      }
    },
  },
});
