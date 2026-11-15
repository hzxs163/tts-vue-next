import { defineStore } from "pinia";
import { invoke } from "@tauri-apps/api/core";
import type { Voice } from "../types";

const VOICE_CACHE_KEY = "tts_voices_cache_v1";

interface VoiceCache {
  savedAt: number;
  voices: Voice[];
}

interface VoicesState {
  voices: Voice[];
  loading: boolean;
  error: string | null;
  usingCache: boolean;
  cacheSavedAt: number | null;
  selectedLocale: string;
  selectedVoice: string;
}

function readVoiceCache(): VoiceCache | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(VOICE_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<VoiceCache>;
    if (
      typeof parsed.savedAt !== "number" ||
      !Array.isArray(parsed.voices) ||
      parsed.voices.length === 0
    ) {
      return null;
    }

    return { savedAt: parsed.savedAt, voices: parsed.voices };
  } catch {
    return null;
  }
}

function writeVoiceCache(voices: Voice[]): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      VOICE_CACHE_KEY,
      JSON.stringify({ savedAt: Date.now(), voices }),
    );
  } catch {
    return;
  }
}

function resolveSelection(
  voices: Voice[],
  selectedLocale: string,
  selectedVoice: string,
): Pick<VoicesState, "selectedLocale" | "selectedVoice"> {
  const matchingVoice = voices.find(
    (voice) => voice.ShortName === selectedVoice,
  );
  if (matchingVoice) {
    return {
      selectedLocale: matchingVoice.Locale,
      selectedVoice: matchingVoice.ShortName,
    };
  }

  const localeVoice = voices.find((voice) => voice.Locale === selectedLocale);
  if (localeVoice) {
    return {
      selectedLocale: localeVoice.Locale,
      selectedVoice: localeVoice.ShortName,
    };
  }

  const zhVoice = voices.find((voice) => voice.Locale === "zh-CN");
  if (zhVoice) {
    return {
      selectedLocale: zhVoice.Locale,
      selectedVoice: zhVoice.ShortName,
    };
  }

  const firstVoice = voices[0];
  return {
    selectedLocale: firstVoice?.Locale ?? selectedLocale,
    selectedVoice: firstVoice?.ShortName ?? selectedVoice,
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useVoicesStore = defineStore("voices", {
  state: (): VoicesState => ({
    voices: [],
    loading: false,
    error: null,
    usingCache: false,
    cacheSavedAt: null,
    selectedLocale: "zh-CN",
    selectedVoice: "zh-CN-XiaoxiaoNeural",
  }),

  getters: {
    locales(state): string[] {
      return Array.from(
        new Set(state.voices.map((voice) => voice.Locale)),
      ).sort();
    },

    filteredVoices(state): Voice[] {
      return state.voices.filter(
        (voice) => voice.Locale === state.selectedLocale,
      );
    },

    currentVoice(state): Voice | undefined {
      return state.voices.find(
        (voice) => voice.ShortName === state.selectedVoice,
      );
    },
  },

  actions: {
    async fetchVoices() {
      if (this.voices.length > 0) {
        return;
      }

      this.$patch({ loading: true, error: null });

      try {
        const voices = await invoke<Voice[]>("get_voices");
        const selection = resolveSelection(
          voices,
          this.selectedLocale,
          this.selectedVoice,
        );

        writeVoiceCache(voices);
        this.$patch({
          voices,
          error: null,
          usingCache: false,
          cacheSavedAt: null,
          ...selection,
        });
      } catch (error) {
        const message = toErrorMessage(error);
        const cached = readVoiceCache();

        if (!cached) {
          this.$patch({
            error: message,
            usingCache: false,
            cacheSavedAt: null,
          });
          return;
        }

        const selection = resolveSelection(
          cached.voices,
          this.selectedLocale,
          this.selectedVoice,
        );
        this.$patch({
          voices: cached.voices,
          error: message,
          usingCache: true,
          cacheSavedAt: cached.savedAt,
          ...selection,
        });
      } finally {
        this.$patch({ loading: false });
      }
    },

    setLocale(locale: string) {
      const firstVoiceForLocale = this.voices.find(
        (voice) => voice.Locale === locale,
      );
      if (!firstVoiceForLocale) {
        return;
      }

      this.$patch({
        selectedLocale: locale,
        selectedVoice: firstVoiceForLocale.ShortName,
      });
    },

    setVoice(shortName: string) {
      const voice = this.voices.find((item) => item.ShortName === shortName);
      if (!voice) {
        return;
      }

      this.$patch({
        selectedLocale: voice.Locale,
        selectedVoice: shortName,
      });
    },
  },

  persist: {
    pick: ["selectedLocale", "selectedVoice"],
  },
});
