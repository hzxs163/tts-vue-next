import { defineStore } from "pinia";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "./settings";
import type { AzureCredentials, OpenAiCredentials, TtsProviderId, Voice } from "../types";

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
  /** Which catalog the selection below refers to. */
  selectedProvider: TtsProviderId;
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
/**
 * Placeholder locale for voices that do not belong to one, such as the OpenAI
 * compatible catalog. Every picker groups by locale, so they need a value.
 */
export const OPENAI_LOCALE = "custom";

/**
 * Builds the OpenAI compatible catalog from the configured voice ids.
 *
 * The protocol has no endpoint that lists voices, so the list is maintained in
 * the settings instead.
 */
function buildOpenAiVoices(configured: string): Voice[] {
  return configured
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({
      Name: name,
      ShortName: name,
      Gender: "",
      Locale: OPENAI_LOCALE,
      SuggestedCodec: "",
      FriendlyName: name,
      Status: "GA",
      VoiceTag: { ContentCategories: [], VoicePersonalities: [] },
    }));
}

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
    selectedProvider: "edge",
    selectedLocale: "zh-CN",
    selectedVoice: "zh-CN-XiaoxiaoNeural",
    favorites: [],
    azureVoices: [],
    azureLoading: false,
    azureError: null,
  }),

  getters: {
    /**
     * Catalog the current selection applies to.
     *
     * The whole app treats "the selected voice" as a (provider, locale, voice)
     * triple, so switching the provider also switches the catalog behind it.
     */
    activeVoices(state): Voice[] {
      // Mirrors `requestProvider`: a provider that is selected but not fully
      // configured falls back to Edge, so the catalog must fall back with it.
      // Otherwise the picker would list nothing while the request still used
      // the Edge voices.
      const settings = useSettingsStore();

      if (
        state.selectedProvider === "azure" &&
        settings.azureEnabled &&
        settings.azureKey &&
        settings.azureRegion
      ) {
        return state.azureVoices;
      }

      if (
        state.selectedProvider === "openai" &&
        settings.openaiKey.trim() &&
        settings.openaiBaseUrl.trim()
      ) {
        return this.openaiVoices;
      }

      return state.voices;
    },

    locales(): string[] {
      return Array.from(new Set(this.activeVoices.map((voice) => voice.Locale))).sort();
    },

    filteredVoices(state): Voice[] {
      const list = this.activeVoices.filter((voice) => voice.Locale === state.selectedLocale);
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

    /**
     * Request routing for the current selection.
     *
     * Falls back to the free Edge endpoint whenever Azure is selected but not
     * fully configured, so a half-filled settings form cannot make every
     * conversion fail.
     */
    requestProvider(): {
      provider: TtsProviderId;
      azure: AzureCredentials | null;
      openai: OpenAiCredentials | null;
    } {
      const settings = useSettingsStore();
      const fallback = { provider: "edge" as TtsProviderId, azure: null, openai: null };

      if (this.selectedProvider === "azure") {
        if (!settings.azureEnabled || !settings.azureKey || !settings.azureRegion) {
          return fallback;
        }
        return {
          provider: "azure",
          azure: { key: settings.azureKey, region: settings.azureRegion },
          openai: null,
        };
      }

      if (this.selectedProvider === "openai") {
        if (!settings.openaiKey.trim() || !settings.openaiBaseUrl.trim()) {
          return fallback;
        }
        return {
          provider: "openai",
          azure: null,
          openai: {
            key: settings.openaiKey,
            baseUrl: settings.openaiBaseUrl,
            model: settings.openaiModel,
          },
        };
      }

      return fallback;
    },

    /** Catalog of the configured OpenAI compatible endpoint. */
    openaiVoices(): Voice[] {
      return buildOpenAiVoices(useSettingsStore().openaiVoices);
    },

    currentVoice(): Voice | undefined {
      return this.activeVoices.find((voice) => voice.ShortName === this.selectedVoice);
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
        // The persisted selection may predate this catalog; resolve it so the
        // picker and the preview agree on a voice that actually exists.
        this.$patch(resolveSelection(this.activeVoices, this.selectedLocale, this.selectedVoice));
        return true;
      } catch (error) {
        this.$patch({ azureVoices: [], azureError: toErrorMessage(error) });
        return false;
      } finally {
        this.$patch({ azureLoading: false });
      }
    },

    /**
     * Loads the catalog the persisted provider needs.
     *
     * Only the Edge list used to be fetched on start-up, so a session that
     * ended on Azure (or OpenAI) reopened with an empty, unselectable list.
     */
    async ensureActiveCatalog(): Promise<void> {
      const settings = useSettingsStore();
      const azureUsable =
        settings.azureEnabled && Boolean(settings.azureKey) && Boolean(settings.azureRegion);

      if (this.selectedProvider === "azure" && azureUsable) {
        if (this.azureVoices.length === 0) {
          await this.fetchAzureVoices({
            key: settings.azureKey,
            region: settings.azureRegion,
          });
        }
        return;
      }

      await this.fetchVoices();
    },

    /**
     * Switches the active catalog.
     *
     * Fetching the Azure list on demand keeps the paid request off the startup
     * path while still making the switch feel immediate.
     */
    async setProvider(provider: TtsProviderId) {
      if (provider === this.selectedProvider) {
        return;
      }

      this.$patch({ selectedProvider: provider });

      if (provider === "azure" && this.azureVoices.length === 0) {
        const settings = useSettingsStore();
        await this.fetchAzureVoices({
          key: settings.azureKey,
          region: settings.azureRegion,
        });
      }

      const selection = resolveSelection(
        this.activeVoices,
        this.selectedLocale,
        this.selectedVoice,
      );
      this.$patch(selection);
    },

    setLocale(locale: string) {
      const firstVoiceForLocale = this.activeVoices.find((voice) => voice.Locale === locale);
      if (!firstVoiceForLocale) {
        return;
      }

      this.$patch({
        selectedLocale: locale,
        selectedVoice: firstVoiceForLocale.ShortName,
      });
    },

    setVoice(shortName: string) {
      // Must look in the *active* catalog: an Azure voice is not part of the
      // Edge list, and looking there made the selection silently ignored.
      const voice = this.activeVoices.find((item) => item.ShortName === shortName);
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
    pick: ["selectedProvider", "selectedLocale", "selectedVoice", "favorites"],
  },
});
