import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { DUCKING_PRESETS, useBgmStore } from "./bgm";

const { invokeMock, openMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  openMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: openMock,
}));

describe("useBgmStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    invokeMock.mockReset();
    openMock.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes with default settings", () => {
    const store = useBgmStore();
    expect(store.enabled).toBe(false);
    expect(store.bgmPath).toBe("");
    expect(store.bgmVolume).toBe(0.3);
    expect(store.enableDucking).toBe(true);
    expect(store.duckingStrength).toBe("medium");
    expect(store.hasBgmFile).toBe(false);
    expect(store.isConfigured).toBe(false);
  });

  it("updates ducking presets correctly", () => {
    const store = useBgmStore();
    store.setDuckingStrength("strong");
    expect(store.duckingStrength).toBe("strong");
    expect(store.duckingRatio).toBe(DUCKING_PRESETS.strong.ratio);
    expect(store.duckingThreshold).toBe(DUCKING_PRESETS.strong.threshold);

    store.setDuckingStrength("gentle");
    expect(store.duckingStrength).toBe("gentle");
    expect(store.duckingRatio).toBe(DUCKING_PRESETS.gentle.ratio);
    expect(store.duckingThreshold).toBe(DUCKING_PRESETS.gentle.threshold);
  });

  it("handles BGM file picking and clearing", async () => {
    const store = useBgmStore();
    openMock.mockResolvedValueOnce("C:\\Music\\ambient.mp3");

    const result = await store.pickBgmFile();
    expect(result).toBe(true);
    expect(store.bgmPath).toBe("C:\\Music\\ambient.mp3");
    expect(store.bgmName).toBe("ambient.mp3");
    expect(store.hasBgmFile).toBe(true);

    store.setEnabled(true);
    expect(store.isConfigured).toBe(true);

    store.clearBgm();
    expect(store.bgmPath).toBe("");
    expect(store.hasBgmFile).toBe(false);
    expect(store.isConfigured).toBe(false);
  });

  it("mixes BGM audio via Tauri command", async () => {
    const store = useBgmStore();
    store.setBgmFile("C:\\bgm.mp3");
    store.setBgmVolume(0.4);
    invokeMock.mockResolvedValueOnce(undefined);

    await store.mixBgm("C:\\vocal.mp3", "C:\\out.mp3", "mp3");

    expect(invokeMock).toHaveBeenCalledWith("mix_bgm", {
      params: {
        vocal_path: "C:\\vocal.mp3",
        bgm_path: "C:\\bgm.mp3",
        output_path: "C:\\out.mp3",
        bgm_volume: 0.4,
        enable_ducking: true,
        ducking_ratio: 4.0,
        ducking_threshold: 0.08,
        fade_out_sec: 2.0,
        format: "mp3",
      },
    });
  });

  it("throws error if mixing without selected BGM file", async () => {
    const store = useBgmStore();
    store.clearBgm();
    await expect(store.mixBgm("C:\\vocal.mp3", "C:\\out.mp3")).rejects.toThrow(
      "No BGM file selected",
    );
  });
});
