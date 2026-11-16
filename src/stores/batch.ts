import i18n from "../plugins/i18n";
import { defineStore } from "pinia";
import { invoke } from "@tauri-apps/api/core";
import type {
  BatchFile,
  ConflictStrategy,
  OutputFormat,
  TtsParams,
  TtsProgressEvent,
} from "../types";
import { useSettingsStore } from "./settings";
import { useVoicesStore } from "./voices";
import { saveAudioBytes } from "../utils/saveAudio";
import { toErrorMessage } from "../utils/ttsErrors";

const EDGE_TTS_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const DEFAULT_RATE = "+0%";
const DEFAULT_PITCH = "+0Hz";
const DEFAULT_VOLUME = "+0%";

interface BatchState {
  files: BatchFile[];
  converting: boolean;
  stopRequested: boolean;
}

interface BatchExecutionSnapshot {
  savePath: string;
  outputFormat: OutputFormat;
  maxRetries: number;
  fileConcurrency: number;
  chunkConcurrency: number;
  conflictStrategy: ConflictStrategy;
  selectedVoice: string;
}

function toFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function replaceExtension(fileName: string, extension: OutputFormat): string {
  const baseName = fileName.replace(/\.[^.]+$/, "") || fileName;
  return `${baseName}.${extension}`;
}

function joinPath(directory: string, fileName: string): string {
  if (!directory) {
    return fileName;
  }

  const separator = directory.includes("\\") && !directory.includes("/") ? "\\" : "/";
  return `${directory.replace(/[\\/]+$/, "")}${separator}${fileName}`;
}

function resolveOutputDirectory(filePath: string, configuredDirectory: string): string {
  if (configuredDirectory) {
    return configuredDirectory;
  }

  const segments = filePath.split(/[\\/]/);
  if (segments.length <= 1) {
    return "";
  }

  return filePath
    .slice(0, filePath.length - segments[segments.length - 1].length)
    .replace(/[\\/]+$/, "");
}

function toOutputPath(file: BatchFile, outputFormat: OutputFormat, savePath: string): string {
  const outputName = replaceExtension(file.name, outputFormat);
  const outputDirectory = resolveOutputDirectory(file.path, savePath);
  return joinPath(outputDirectory, outputName);
}

function updateFile(files: BatchFile[], id: string, patch: Partial<BatchFile>): BatchFile[] {
  return files.map((file) => (file.id === id ? { ...file, ...patch } : file));
}

export const useBatchStore = defineStore("batch", {
  state: (): BatchState => ({
    files: [],
    converting: false,
    stopRequested: false,
  }),

  actions: {
    applyProgress(event: TtsProgressEvent) {
      if (!this.converting || event.total <= 0) {
        return;
      }

      const file = this.files.find((item) => item.id === event.taskId);
      if (!file || file.status !== "processing") {
        return;
      }

      const ratio = Math.min(1, event.completed / event.total);
      this.$patch((state) => {
        state.files = updateFile(state.files, event.taskId, {
          progress: 30 + Math.round(50 * ratio),
        });
      });
    },

    addFiles(filePaths: string[]) {
      const knownPaths = new Set(this.files.map((file) => file.path));
      const uniquePaths = filePaths.filter((path) => {
        if (knownPaths.has(path)) {
          return false;
        }

        knownPaths.add(path);
        return true;
      });
      const nextFiles = uniquePaths.map<BatchFile>((path) => ({
        id: crypto.randomUUID(),
        name: toFileName(path),
        path,
        size: 0,
        status: "pending",
        progress: 0,
      }));

      if (nextFiles.length === 0) {
        return;
      }

      this.$patch((state) => {
        state.files = [...state.files, ...nextFiles];
      });
    },

    removeFile(id: string) {
      this.$patch((state) => {
        state.files = state.files.filter((file) => file.id !== id);
      });
    },

    clearFiles() {
      this.$patch({ files: [] });
    },

    retryFile(id: string) {
      this.$patch((state) => {
        state.files = updateFile(state.files, id, {
          status: "pending",
          progress: 0,
          error: undefined,
        });
      });
    },

    /**
     * Cancels every running conversion and stops the worker pool from picking up
     * queued files. Cancelled files return to `pending` so they can be resumed.
     */
    stopAll() {
      if (!this.converting) {
        return;
      }

      this.$patch({ stopRequested: true });

      for (const file of this.files) {
        if (file.status !== "processing") {
          continue;
        }

        void invoke("tts_stop", { taskId: file.id }).catch(() => undefined);
      }
    },

    async convertAll() {
      if (this.converting) {
        return;
      }

      const fileIds = this.files
        .filter((file) => file.status === "pending" || file.status === "error")
        .map((file) => file.id);

      if (fileIds.length === 0) {
        return;
      }

      const settingsStore = useSettingsStore();
      const voicesStore = useVoicesStore();
      const snapshot: BatchExecutionSnapshot = {
        savePath: settingsStore.savePath,
        outputFormat: settingsStore.outputFormat,
        maxRetries: settingsStore.maxRetries,
        fileConcurrency: settingsStore.fileConcurrency,
        chunkConcurrency: settingsStore.chunkConcurrency,
        conflictStrategy: settingsStore.conflictStrategy,
        selectedVoice: voicesStore.selectedVoice,
      };
      const workerCount = Math.min(snapshot.fileConcurrency, fileIds.length);
      let nextIndex = 0;

      this.$patch({ converting: true, stopRequested: false });

      const processFile = async (fileId: string) => {
        const file = this.files.find((item) => item.id === fileId);
        if (!file) {
          return;
        }

        const requestedOutputPath = toOutputPath(file, snapshot.outputFormat, snapshot.savePath);
        const params: TtsParams = {
          text: "",
          voice: snapshot.selectedVoice,
          rate: DEFAULT_RATE,
          pitch: DEFAULT_PITCH,
          volume: DEFAULT_VOLUME,
          format: EDGE_TTS_OUTPUT_FORMAT,
          task_id: file.id,
          max_retries: snapshot.maxRetries,
          chunk_concurrency: snapshot.chunkConcurrency,
        };
        this.$patch((state) => {
          state.files = updateFile(state.files, file.id, {
            status: "processing",
            progress: 10,
            error: undefined,
          });
        });

        const markPending = () => {
          this.$patch((state) => {
            state.files = updateFile(state.files, file.id, {
              status: "pending",
              progress: 0,
              error: undefined,
            });
          });
        };

        try {
          if (this.stopRequested) {
            markPending();
            return;
          }

          const resolvedOutputPath = await invoke<string | null>("resolve_output_path", {
            path: requestedOutputPath,
            strategy: snapshot.conflictStrategy,
          });

          if (resolvedOutputPath === null) {
            this.$patch((state) => {
              state.files = updateFile(state.files, file.id, {
                status: "skipped",
                progress: 100,
                outputPath: undefined,
                error: undefined,
              });
            });
            return;
          }

          const outputPath = resolvedOutputPath;
          const text = await invoke<string>("read_text_file", { path: file.path });
          if (this.stopRequested) {
            markPending();
            return;
          }
          params.text = text;

          this.$patch((state) => {
            state.files = updateFile(state.files, file.id, { progress: 30 });
          });

          const audioBuffer = await invoke<ArrayBuffer>("tts_convert", { params });
          if (this.stopRequested) {
            markPending();
            return;
          }

          this.$patch((state) => {
            state.files = updateFile(state.files, file.id, { progress: 80 });
          });

          const { cleanupError, cleanupPath } = await saveAudioBytes(
            new Uint8Array(audioBuffer),
            outputPath,
            snapshot.outputFormat,
          );
          const cleanupWarning = cleanupError
            ? i18n.global.t("batch.errors.failedToRemoveTempFile", {
                path: cleanupPath ?? "",
                message: cleanupError,
              })
            : null;

          this.$patch((state) => {
            state.files = updateFile(state.files, file.id, {
              status: "done",
              progress: 100,
              outputPath,
              error: cleanupWarning ?? undefined,
            });
          });
        } catch (error) {
          if (this.stopRequested) {
            markPending();
            return;
          }

          this.$patch((state) => {
            state.files = updateFile(state.files, file.id, {
              status: "error",
              progress: 0,
              error: toErrorMessage(error),
            });
          });
        }
      };

      const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < fileIds.length && !this.stopRequested) {
          const currentId = fileIds[nextIndex];
          nextIndex += 1;
          await processFile(currentId);
        }
      });

      try {
        await Promise.all(workers);
      } finally {
        this.$patch({ converting: false, stopRequested: false });
      }
    },
  },
});
