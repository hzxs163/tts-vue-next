import i18n from "../plugins/i18n";
import { defineStore } from "pinia";
import { invoke } from "@tauri-apps/api/core";
import type {
  BatchFile,
  ConflictStrategy,
  NovelChapter,
  OutputFormat,
  SubtitleTrack,
  TtsParams,
  TtsProgressEvent,
} from "../types";
import { useSettingsStore } from "./settings";
import { useVoicesStore } from "./voices";
import { useDictionaryStore } from "./dictionary";
import { useBgmStore } from "./bgm";
import { saveAudioBytes } from "../utils/saveAudio";
import { toErrorMessage } from "../utils/ttsErrors";
import { sanitizeContentForFileName } from "../utils/fileName";

const EDGE_TTS_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const DEFAULT_RATE = "+0%";
const DEFAULT_PITCH = "+0Hz";
const DEFAULT_VOLUME = "+0%";
/** Longest chapter file name stem, leaving room for the prefix and extension. */
const MAX_CHAPTER_NAME_LENGTH = 80;

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
  exportSubtitles: boolean;
  selectedVoice: string;
  requestProvider: Pick<TtsParams, "provider" | "azure">;
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

/**
 * Fetches the subtitle track produced by a finished `tts_convert` call.
 *
 * The track is retrieved with an explicit command instead of an event so the
 * result can never be lost to an event/response ordering race. Failures are
 * swallowed: subtitles are a nice-to-have next to the audio file.
 */
export async function fetchSubtitleTrack(taskId: string): Promise<SubtitleTrack | null> {
  try {
    return await invoke<SubtitleTrack | null>("tts_get_subtitles", { taskId });
  } catch {
    return null;
  }
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

    addChapters(chapters: NovelChapter[], sourcePath: string, titlePrefix?: string) {
      const nextFiles = chapters.map<BatchFile>((chapter) => {
        // Chapter titles come straight from the source novel, so they may
        // contain characters that are illegal in a Windows file name
        // (`:` `?` `*` `/` `\` `|` `<` `>` `"`). Sanitize before use, otherwise
        // the whole batch fails at write time with an opaque OS error.
        const chapterName = sanitizeContentForFileName(chapter.title, MAX_CHAPTER_NAME_LENGTH);
        const safePrefix = sanitizeContentForFileName(titlePrefix ?? "", MAX_CHAPTER_NAME_LENGTH);
        const baseName = safePrefix ? `${safePrefix}_${chapterName}` : chapterName;
        const fileName = `${baseName || "chapter"}.txt`;
        return {
          id: crypto.randomUUID(),
          name: fileName,
          path: sourcePath,
          size: new Blob([chapter.content]).size,
          status: "pending",
          progress: 0,
          content: chapter.content,
          chapterIndex: chapter.index,
        };
      });

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
        exportSubtitles: settingsStore.exportSubtitles,
        selectedVoice: voicesStore.selectedVoice,
        // Snapshotted with the rest of the settings: a batch started on Azure
        // must not switch providers halfway if the user changes the selection.
        requestProvider: voicesStore.requestProvider,
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
          ...snapshot.requestProvider,
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
          const text =
            file.content !== undefined
              ? file.content
              : await invoke<string>("read_text_file", { path: file.path });
          if (this.stopRequested) {
            markPending();
            return;
          }
          const dictionaryStore = useDictionaryStore();
          params.text = dictionaryStore.applyDictionary(text);

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

          const bgmStore = useBgmStore();
          const bgmOptions = bgmStore.isConfigured
            ? {
                enabled: bgmStore.enabled,
                bgmPath: bgmStore.bgmPath,
                bgmVolume: bgmStore.bgmVolume,
                enableDucking: bgmStore.enableDucking,
                duckingRatio: bgmStore.duckingRatio,
                duckingThreshold: bgmStore.duckingThreshold,
                fadeOutSec: bgmStore.fadeOutSec,
              }
            : undefined;

          const { cleanupError, cleanupPath } = await saveAudioBytes(
            new Uint8Array(audioBuffer),
            outputPath,
            snapshot.outputFormat,
            bgmOptions,
          );

          if (snapshot.exportSubtitles) {
            const srtData = await fetchSubtitleTrack(file.id);
            if (srtData) {
              const srtPath = outputPath.replace(/\.[^.]+$/, "") + ".srt";
              try {
                await invoke("write_text_file", { path: srtPath, content: srtData });
              } catch {
                // Ignore subtitle write error so audio remains saved
              }
            }
          }

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
