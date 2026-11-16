import { beforeEach, describe, expect, test, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { saveAudioBytes } from "./saveAudio";

describe("saveAudioBytes", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  test("writes MP3 directly without conversion or temporary files", async () => {
    invokeMock.mockResolvedValue(undefined);

    const result = await saveAudioBytes(new Uint8Array([1, 2, 3]), "C:/out/a.mp3", "mp3");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("write_binary_file", {
      path: "C:/out/a.mp3",
      data: "AQID",
    });
    expect(result).toEqual({ cleanupError: null, cleanupPath: null });
  });

  test("converts non-mp3 through a temporary file and removes it", async () => {
    invokeMock.mockResolvedValue(undefined);

    const result = await saveAudioBytes(new Uint8Array([1, 2, 3]), "C:/out/a.wav", "wav");

    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      "write_binary_file",
      "convert_audio_format",
      "remove_file",
    ]);
    expect(invokeMock).toHaveBeenCalledWith("write_binary_file", {
      path: "C:/out/a.wav.tmp.mp3",
      data: "AQID",
    });
    expect(invokeMock).toHaveBeenCalledWith("convert_audio_format", {
      inputPath: "C:/out/a.wav.tmp.mp3",
      outputPath: "C:/out/a.wav",
      format: "wav",
    });
    expect(result).toEqual({
      cleanupError: null,
      cleanupPath: "C:/out/a.wav.tmp.mp3",
    });
  });

  test("reports cleanup failure without failing the saved file", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "remove_file") {
        throw new Error("file is locked");
      }
      return undefined;
    });

    const result = await saveAudioBytes(new Uint8Array([1]), "C:/out/a.flac", "flac");

    expect(result.cleanupError).toContain("file is locked");
  });

  test("keeps the conversion error and appends cleanup details", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "convert_audio_format") {
        throw new Error("convert failed");
      }
      if (command === "remove_file") {
        throw new Error("file is locked");
      }
      return undefined;
    });

    await expect(saveAudioBytes(new Uint8Array([1]), "C:/out/a.ogg", "ogg")).rejects.toThrow(
      /convert failed[\s\S]*file is locked/,
    );
  });

  test("does not remove a temp file that was never written", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "write_binary_file") {
        throw new Error("disk full");
      }
      return undefined;
    });

    await expect(saveAudioBytes(new Uint8Array([1]), "C:/out/a.wav", "wav")).rejects.toThrow(
      "disk full",
    );
    expect(invokeMock).not.toHaveBeenCalledWith("remove_file", expect.anything());
  });
});
