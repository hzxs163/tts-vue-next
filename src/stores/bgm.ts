import { defineStore } from "pinia";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { BgmMixParams, BgmSettings, DuckingStrength } from "../types";

export const BGM_STORAGE_KEY = "tts_bgm_settings_v1";

export const DUCKING_PRESETS: Record<DuckingStrength, { ratio: number; threshold: number }> = {
  gentle: { ratio: 2.5, threshold: 0.15 },
  medium: { ratio: 4.0, threshold: 0.08 },
  strong: { ratio: 8.0, threshold: 0.03 },
};

const DEFAULT_SETTINGS: BgmSettings = {
  enabled: false,
  bgmPath: "",
  bgmName: "",
  bgmVolume: 0.3,
  enableDucking: true,
  duckingStrength: "medium",
  duckingRatio: 4.0,
  duckingThreshold: 0.08,
  fadeOutSec: 2.0,
};

function loadSettings(): BgmSettings {
  try {
    const raw = localStorage.getItem(BGM_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
      };
    }
  } catch {
    // Ignore storage parse error
  }
  return { ...DEFAULT_SETTINGS };
}

export const useBgmStore = defineStore("bgm", {
  state: (): BgmSettings & { isMixing: boolean } => ({
    ...loadSettings(),
    isMixing: false,
  }),

  getters: {
    hasBgmFile: (state) => Boolean(state.bgmPath && state.bgmPath.trim().length > 0),
    isConfigured: (state) =>
      Boolean(state.enabled && state.bgmPath && state.bgmPath.trim().length > 0),
  },

  actions: {
    saveSettings() {
      try {
        const settings: BgmSettings = {
          enabled: this.enabled,
          bgmPath: this.bgmPath,
          bgmName: this.bgmName,
          bgmVolume: this.bgmVolume,
          enableDucking: this.enableDucking,
          duckingStrength: this.duckingStrength,
          duckingRatio: this.duckingRatio,
          duckingThreshold: this.duckingThreshold,
          fadeOutSec: this.fadeOutSec,
        };
        localStorage.setItem(BGM_STORAGE_KEY, JSON.stringify(settings));
      } catch {
        // Ignore storage write error
      }
    },

    setEnabled(value: boolean) {
      this.enabled = value;
      this.saveSettings();
    },

    setBgmFile(path: string, name?: string) {
      this.bgmPath = path;
      this.bgmName = name || path.split(/[\\/]/).pop() || path;
      this.saveSettings();
    },

    clearBgm() {
      this.bgmPath = "";
      this.bgmName = "";
      this.saveSettings();
    },

    async pickBgmFile(): Promise<boolean> {
      try {
        const selected = await open({
          multiple: false,
          filters: [
            {
              name: "Audio Files (*.mp3, *.wav, *.ogg, *.flac, *.m4a, *.aac)",
              extensions: ["mp3", "wav", "ogg", "flac", "m4a", "aac"],
            },
          ],
        });

        if (selected && typeof selected === "string") {
          this.setBgmFile(selected);
          return true;
        }
      } catch (error) {
        console.error("Failed to pick BGM file:", error);
      }
      return false;
    },

    setBgmVolume(volume: number) {
      this.bgmVolume = Math.max(0.01, Math.min(2.0, volume));
      this.saveSettings();
    },

    setEnableDucking(enabled: boolean) {
      this.enableDucking = enabled;
      this.saveSettings();
    },

    setDuckingStrength(strength: DuckingStrength) {
      this.duckingStrength = strength;
      const preset = DUCKING_PRESETS[strength];
      if (preset) {
        this.duckingRatio = preset.ratio;
        this.duckingThreshold = preset.threshold;
      }
      this.saveSettings();
    },

    setCustomDucking(ratio: number, threshold: number) {
      this.duckingRatio = Math.max(1.5, Math.min(20.0, ratio));
      this.duckingThreshold = Math.max(0.01, Math.min(0.5, threshold));
      this.saveSettings();
    },

    setFadeOutSec(sec: number) {
      this.fadeOutSec = Math.max(0, Math.min(5.0, sec));
      this.saveSettings();
    },

    async mixBgm(vocalPath: string, outputPath: string, format?: string): Promise<void> {
      if (!this.bgmPath) {
        throw new Error("No BGM file selected");
      }

      this.isMixing = true;
      try {
        const fmt = (format || outputPath.split(".").pop() || "mp3").toLowerCase();
        const params: BgmMixParams = {
          vocal_path: vocalPath,
          bgm_path: this.bgmPath,
          output_path: outputPath,
          bgm_volume: this.bgmVolume,
          enable_ducking: this.enableDucking,
          ducking_ratio: this.duckingRatio,
          ducking_threshold: this.duckingThreshold,
          fade_out_sec: this.fadeOutSec,
          format: fmt,
        };
        await invoke("mix_bgm", { params });
      } finally {
        this.isMixing = false;
      }
    },
  },
});
