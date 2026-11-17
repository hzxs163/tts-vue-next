import { defineStore } from "pinia";
import { invoke } from "@tauri-apps/api/core";
import type { AzureCredentials, Voice } from "../types";

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
  favorites: string[];
  /** Voices of the configured Azure resource, empty until it is verified. */
  azureVoices: Voice[];
  azureLoading: boolean;
  azureError: string | null;
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
    window.localStorage.setItem(VOICE_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), voices }));
  } catch {
    return;
  }
}

/**
 * Groups a voice list by locale. Shared by the Edge and Azure catalogs so both
 * behave the same in the cast picker.
 */
function groupVoicesByLocale(voices: Voice[]): Voice[][] {
  const groups = new Map<string, Voice[]>();

  for (const voice of voices) {
    const list = groups.get(voice.Locale);
    if (list) {
      list.push(voice);
    } else {
      groups.set(voice.Locale, [voice]);
    }
  }

  return [...groups.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((locale) =>
      groups
        .get(locale)!
        .slice()
        .sort((a, b) =>
          (a.FriendlyName || a.ShortName).localeCompare(b.FriendlyName || b.ShortName),
        ),
    );
}

function resolveSelection(
  voices: Voice[],
  selectedLocale: string,
  selectedVoice: string,
): Pick<VoicesState, "selectedLocale" | "selectedVoice"> {
  const matchingVoice = voices.find((voice) => voice.ShortName === selectedVoice);
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
    favorites: [],
    azureVoices: [],
    azureLoading: false,
    azureError: null,
  }),

  getters: {
    locales(state): string[] {
      return Array.from(new Set(state.voices.map((voice) => voice.Locale))).sort();
    },

    filteredVoices(state): Voice[] {
      const list = state.voices.filter((voice) => voice.Locale === state.selectedLocale);
      return [...list].sort((a, b) => {
        const aFav = state.favorites.includes(a.ShortName) ? 1 : 0;
        const bFav = state.favorites.includes(b.ShortName) ? 1 : 0;
        if (aFav !== bFav) {
          return bFav - aFav;
        }
        return (a.FriendlyName || a.ShortName).localeCompare(b.FriendlyName || b.ShortName);
      });
    },

    isFavorite(state) {
      return (shortName: string): boolean => state.favorites.includes(shortName);
    },

    /**
     * The whole catalog grouped by locale, independent of `selectedLocale`.
     *
     * The single-speaker panel filters by the locale the user picked there,
     * but the dialogue cast has to assign any voice to any role: a radio
     * drama may mix zh-CN with zh-TW, or a bilingual scene needs an English
     * voice next to a Chinese one.
     */
    voicesByLocale(): Voice[][] {
      return groupVoicesByLocale(this.voices);
    },

    /** The Azure catalog grouped the same way as the Edge one. */
    azureVoicesByLocale(): Voice[][] {
      return groupVoicesByLocale(this.azureVoices);
    },

    currentVoice(state): Voice | undefined {
      return state.voices.find((voice) => voice.ShortName === state.selectedVoice);
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
        const selection = resolveSelection(voices, this.selectedLocale, this.selectedVoice);

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

        const selection = resolveSelection(cached.voices, this.selectedLocale, this.selectedVoice);
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

    /**
     * Loads the voice list of an Azure resource.
     *
     * Credentials are passed in rather than read here so the caller decides
     * when a paid request is worth making (for example on an explicit
     * "verify" click instead of on every page load).
     */
    async fetchAzureVoices(credentials: AzureCredentials): Promise<boolean> {
      if (this.azureLoading) {
        return false;
      }

      if (!credentials.key || !credentials.region) {
        this.$patch({
          azureVoices: [],
          azureError: "Azure key and region are required",
        });
        return false;
      }

      this.$patch({ azureLoading: true, azureError: null });

      try {
        const voices = await invoke<Voice[]>("get_azure_voices", { credentials });
        this.$patch({ azureVoices: voices, azureError: null });
        return true;
      } catch (error) {
        this.$patch({ azureVoices: [], azureError: toErrorMessage(error) });
        return false;
      } finally {
        this.$patch({ azureLoading: false });
      }
    },

    setLocale(locale: string) {
      const firstVoiceForLocale = this.voices.find((voice) => voice.Locale === locale);
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

    toggleFavorite(shortName: string) {
      const isFav = this.favorites.includes(shortName);
      const updated = isFav
        ? this.favorites.filter((name) => name !== shortName)
        : [...this.favorites, shortName];

      this.$patch({ favorites: updated });
    },
  },

  persist: {
    pick: ["selectedLocale", "selectedVoice", "favorites"],
  },
});
