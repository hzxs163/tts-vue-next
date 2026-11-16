import { invoke } from "@tauri-apps/api/core";
import type { OutputFormat } from "../types";
import { bytesToBase64 } from "./bytes";

export interface SaveAudioResult {
  /** Set when the temporary MP3 could not be removed after a conversion. */
  cleanupError: string | null;
  /** Path of the temporary MP3, when one was involved. */
  cleanupPath: string | null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Persists synthesized MP3 bytes to `outputPath`.
 *
 * MP3 is written directly; every other format goes through a temporary MP3 plus
 * ffmpeg. The single-track player and the batch queue share this pipeline so the
 * temporary-file lifecycle only has to be correct in one place.
 */
export async function saveAudioBytes(
  bytes: Uint8Array,
  outputPath: string,
  format: OutputFormat,
): Promise<SaveAudioResult> {
  const data = bytesToBase64(bytes);

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
