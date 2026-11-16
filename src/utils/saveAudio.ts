import { invoke } from "@tauri-apps/api/core";
import type { OutputFormat } from "../types";
import { bytesToBase64 } from "./bytes";

export interface SaveAudioResult {
  /** Set when the temporary MP3 could not be removed after a conversion. */
  cleanupError: string | null;
  /** Path of the temporary MP3, when one was involved. */
  cleanupPath: string | null;
}

export interface SaveAudioBgmOptions {
  enabled: boolean;
  bgmPath: string;
  bgmVolume: number;
  enableDucking: boolean;
  duckingRatio: number;
  duckingThreshold: number;
  fadeOutSec: number;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Persists synthesized MP3 bytes to `outputPath`, optionally mixing background music.
 *
 * MP3 is written directly when no BGM is active; every other format or BGM mix
 * goes through a temporary MP3 plus ffmpeg. The single-track player, batch queue,
 * and dialogue studio share this pipeline.
 */
export async function saveAudioBytes(
  bytes: Uint8Array,
  outputPath: string,
  format: OutputFormat,
  bgmOptions?: SaveAudioBgmOptions,
): Promise<SaveAudioResult> {
  const data = bytesToBase64(bytes);

  // If BGM is requested and configured, mix it using mix_bgm
  if (bgmOptions?.enabled && bgmOptions.bgmPath) {
    const tempPath = `${outputPath}.tmp.mp3`;
    let wroteTempFile = false;
    let saveError: unknown = null;
    let cleanupError: string | null = null;

    try {
      await invoke("write_binary_file", { path: tempPath, data });
      wroteTempFile = true;
      await invoke("mix_bgm", {
        params: {
          vocal_path: tempPath,
          bgm_path: bgmOptions.bgmPath,
          output_path: outputPath,
          bgm_volume: bgmOptions.bgmVolume,
          enable_ducking: bgmOptions.enableDucking,
          ducking_ratio: bgmOptions.duckingRatio,
          ducking_threshold: bgmOptions.duckingThreshold,
          fade_out_sec: bgmOptions.fadeOutSec,
          format,
        },
      });
    } catch (error) {
      saveError = error;
    } finally {
      if (wroteTempFile) {
        try {
          await invoke("remove_file", { path: tempPath });
        } catch (error) {
          cleanupError = toErrorMessage(error);
        }
      }
    }

    if (saveError) {
      const message = toErrorMessage(saveError);
      throw new Error(cleanupError ? `${message}\n${cleanupError}` : message);
    }

    return { cleanupError, cleanupPath: tempPath };
  }

  if (format === "mp3") {
    await invoke("write_binary_file", { path: outputPath, data });
    return { cleanupError: null, cleanupPath: null };
  }

  const tempPath = `${outputPath}.tmp.mp3`;
  let wroteTempFile = false;
  let saveError: unknown = null;
  let cleanupError: string | null = null;

  try {
    await invoke("write_binary_file", { path: tempPath, data });
    wroteTempFile = true;
    await invoke("convert_audio_format", {
      inputPath: tempPath,
      outputPath,
      format,
    });
  } catch (error) {
    saveError = error;
  } finally {
    if (wroteTempFile) {
      try {
        await invoke("remove_file", { path: tempPath });
      } catch (error) {
        cleanupError = toErrorMessage(error);
      }
    }
  }

  if (saveError) {
    const message = toErrorMessage(saveError);
    throw new Error(cleanupError ? `${message}\n${cleanupError}` : message);
  }

  return { cleanupError, cleanupPath: tempPath };
}
