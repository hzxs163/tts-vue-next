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

  it("supports custom ducking parameters", () => {
    const store = useBgmStore();
    expect(store.customDucking).toBe(false);

    store.setCustomDucking(6.5, 0.25);
    expect(store.customDucking).toBe(true);
    expect(store.duckingRatio).toBe(6.5);
    expect(store.duckingThreshold).toBe(0.25);

    // Switching back to a preset leaves the custom mode.
    store.setDuckingStrength("gentle");
    expect(store.customDucking).toBe(false);
    expect(store.duckingRatio).toBe(DUCKING_PRESETS.gentle.ratio);
  });

  it("clamps custom ducking parameters to the supported range", () => {
    const store = useBgmStore();

    store.setCustomDucking(0.2, 9);
    expect(store.duckingRatio).toBe(1.5);
    expect(store.duckingThreshold).toBe(0.5);

    store.setCustomDucking(99, 0);
    expect(store.duckingRatio).toBe(20);
    expect(store.duckingThreshold).toBe(0.01);
  });

  it("clamps the fade-out duration to the supported range", () => {
    const store = useBgmStore();

    store.setFadeOutSec(-3);
    expect(store.fadeOutSec).toBe(0);

    store.setFadeOutSec(99);
    expect(store.fadeOutSec).toBe(5);

    store.setFadeOutSec(2.5);
    expect(store.fadeOutSec).toBe(2.5);
  });
});
