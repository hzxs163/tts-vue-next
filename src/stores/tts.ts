import { defineStore } from "pinia";
import { invoke } from "@tauri-apps/api/core";
import type { SubtitleTrack, TtsParams, TtsProgressEvent } from "../types";
import { useVoicesStore } from "./voices";
import { useSettingsStore } from "./settings";
import { useDictionaryStore } from "./dictionary";
import { classifyTtsError, toErrorMessage, type TtsErrorKind } from "../utils/ttsErrors";

const EDGE_TTS_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

interface TtsState {
  text: string;
  converting: boolean;
  progress: number;
  audioUrl: string | null;
  audioBytes: Uint8Array | null;
  subtitles: SubtitleTrack | null;
  error: string | null;
  errorKind: TtsErrorKind | null;
  currentTaskId: string | null;
  rate: number;
  pitch: number;
  volume: number;
  requestVersion: number;
}

function toSignedString(value: number, suffix: string): string {
  return `${value >= 0 ? "+" : ""}${value}${suffix}`;
}

function revokeAudioUrl(audioUrl: string | null): void {
  if (audioUrl) {
    URL.revokeObjectURL(audioUrl);
  }
}

export const useTtsStore = defineStore("tts", {
  state: (): TtsState => ({
    text: "",
    converting: false,
    progress: 0,
    audioUrl: null,
    audioBytes: null,
    subtitles: null,
    error: null,
    errorKind: null,
    currentTaskId: null,
    rate: 0,
    pitch: 0,
    volume: 0,
    requestVersion: 0,
  }),

  getters: {
    rateString(state): string {
      return toSignedString(state.rate, "%");
    },
    pitchString(state): string {
      return toSignedString(state.pitch, "Hz");
    },
    volumeString(state): string {
      return toSignedString(state.volume, "%");
    },
    charCount(state): number {
      return state.text.length;
    },
    byteCount(state): number {
      return new TextEncoder().encode(state.text).length;
    },
  },

  actions: {
    setText(text: string) {
      this.$patch({ text });
    },

    applyProgress(event: TtsProgressEvent) {
      if (
        !this.converting ||
        !this.currentTaskId ||
        this.currentTaskId !== event.taskId ||
        event.total <= 0
      ) {
        return;
      }

      this.$patch({
        progress: Math.min(99, Math.round((event.completed / event.total) * 100)),
      });
    },

    applySubtitles(track: SubtitleTrack | null) {
      if (!track || !Array.isArray(track.cues) || typeof track.srt !== "string") {
        return;
      }

      this.$patch({
        subtitles: {
          srt: track.srt,
          vtt: track.vtt,
          cues: track.cues,
        },
      });
    },

    async convert() {
      if (this.converting || !this.text.trim()) {
        return;
      }

      const voicesStore = useVoicesStore();
      const settingsStore = useSettingsStore();
      const dictionaryStore = useDictionaryStore();
      const taskId = crypto.randomUUID();
      const requestVersion = this.requestVersion + 1;
      const textToSynthesize = dictionaryStore.applyDictionary(this.text);
      const params: TtsParams = {
        text: textToSynthesize,
        voice: voicesStore.selectedVoice,
        rate: this.rateString,
        pitch: this.pitchString,
        volume: this.volumeString,
        format: EDGE_TTS_OUTPUT_FORMAT,
        task_id: taskId,
        max_retries: settingsStore.maxRetries,
        chunk_concurrency: settingsStore.chunkConcurrency,
      };

      revokeAudioUrl(this.audioUrl);
      this.$patch({
        converting: true,
        progress: 0,
        error: null,
        errorKind: null,
        currentTaskId: taskId,
        audioUrl: null,
        audioBytes: null,
        subtitles: null,
        requestVersion,
      });

      try {
        const audioBuffer = await invoke<ArrayBuffer>("tts_convert", { params });
        if (this.requestVersion !== requestVersion) {
          return;
        }

        const audioBytes = new Uint8Array(audioBuffer);
        const audioBlob = new Blob([audioBytes], { type: "audio/mpeg" });
        const audioUrl = URL.createObjectURL(audioBlob);

        this.$patch({
          audioBytes,
          audioUrl,
          progress: 100,
          error: null,
        });

        // The subtitle track is fetched explicitly instead of being pushed as
        // an event: an event could arrive after this task was already closed
        // and would then be dropped silently.
        try {
          const track = await invoke<SubtitleTrack | null>("tts_get_subtitles", { taskId });
          if (this.requestVersion === requestVersion) {
            this.applySubtitles(track);
          }
        } catch {
          // Subtitles are optional; the audio is already playable.
        }
      } catch (error) {
        if (this.requestVersion !== requestVersion) {
          return;
        }

        const errorKind = classifyTtsError(error);
        // A user-requested stop is not a failure: reset silently instead of
        // flashing an error toast for an expected action.
        const cancelled = errorKind === "cancelled";

        this.$patch({
          error: cancelled ? null : toErrorMessage(error),
          errorKind: cancelled ? null : errorKind,
          audioBytes: null,
          audioUrl: null,
        });
      } finally {
        if (this.requestVersion === requestVersion) {
          this.$patch({
            converting: false,
            currentTaskId: null,
          });
        }
      }
    },

    async stop() {
      if (!this.currentTaskId) {
        return;
      }

      try {
        await invoke("tts_stop", { taskId: this.currentTaskId });
      } catch {
        return;
      }
    },

    clear() {
      const taskId = this.currentTaskId;
      if (taskId) {
        // Clearing the UI must also stop the backend synthesis; otherwise the
        // conversion keeps consuming service quota with nobody listening.
        void invoke("tts_stop", { taskId }).catch(() => undefined);
      }

      revokeAudioUrl(this.audioUrl);
      this.$patch({
        text: "",
        converting: false,
        audioUrl: null,
        audioBytes: null,
        subtitles: null,
        error: null,
        errorKind: null,
        progress: 0,
        currentTaskId: null,
        requestVersion: this.requestVersion + 1,
      });
    },
  },
});
