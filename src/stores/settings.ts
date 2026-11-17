import { defineStore } from "pinia";
import type {
  AppLanguage,
  ConflictStrategy,
  FileNamePattern,
  OutputFormat,
  ThemeMode,
  TtsSettings,
} from "../types";

const MIN_RETRIES = 1;
const MAX_RETRIES = 10;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 5;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampFinite(value: number, current: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return current;
  }

  return clamp(value, min, max);
}

export const useSettingsStore = defineStore("settings", {
  state: (): TtsSettings => ({
    savePath: "",
    outputFormat: "mp3",
    fileNamePattern: "content",
    maxRetries: 3,
    fileConcurrency: 3,
    chunkConcurrency: 3,
    conflictStrategy: "rename",
    autoplay: true,
    exportSubtitles: false,
    language: "zh-CN",
    themeMode: "system",
    azureKey: "",
    azureRegion: "",
    azureEnabled: false,
    openaiKey: "",
    openaiBaseUrl: "",
    openaiModel: "tts-1",
    openaiVoices: "alloy, echo, fable, onyx, nova, shimmer",
  }),

  actions: {
    updateAzureKey(key: string) {
      this.$patch({ azureKey: key.trim() });
    },
    updateAzureRegion(region: string) {
      this.$patch({ azureRegion: region.trim() });
    },
    updateAzureEnabled(enabled: boolean) {
      this.$patch({ azureEnabled: enabled });
    },
    updateOpenAiKey(key: string) {
      this.$patch({ openaiKey: key.trim() });
    },
    updateOpenAiBaseUrl(baseUrl: string) {
      this.$patch({ openaiBaseUrl: baseUrl.trim() });
    },
    updateOpenAiModel(model: string) {
      this.$patch({ openaiModel: model.trim() });
    },
    updateOpenAiVoices(voices: string) {
      this.$patch({ openaiVoices: voices });
    },

    updateSavePath(path: string) {
      this.$patch({ savePath: path });
    },
    updateExportSubtitles(exportSubtitles: boolean) {
      this.$patch({ exportSubtitles });
    },
    updateOutputFormat(format: OutputFormat) {
      this.$patch({ outputFormat: format });
    },
    updateFileNamePattern(fileNamePattern: FileNamePattern) {
      this.$patch({ fileNamePattern });
    },
    updateMaxRetries(count: number) {
      this.$patch({
        maxRetries: clampFinite(count, this.maxRetries, MIN_RETRIES, MAX_RETRIES),
      });
    },
    updateFileConcurrency(count: number) {
      this.$patch({
        fileConcurrency: clampFinite(count, this.fileConcurrency, MIN_CONCURRENCY, MAX_CONCURRENCY),
      });
    },
    updateChunkConcurrency(count: number) {
      this.$patch({
        chunkConcurrency: clampFinite(
          count,
          this.chunkConcurrency,
          MIN_CONCURRENCY,
          MAX_CONCURRENCY,
        ),
      });
    },
    updateConflictStrategy(conflictStrategy: ConflictStrategy) {
      this.$patch({ conflictStrategy });
    },
    updateAutoplay(autoplay: boolean) {
      this.$patch({ autoplay });
    },
    updateLanguage(language: AppLanguage) {
      this.$patch({ language });
    },
    updateThemeMode(themeMode: ThemeMode) {
      this.$patch({ themeMode });
    },
  },

  persist: true,
});
