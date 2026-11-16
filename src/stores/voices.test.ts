import { beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createApp } from "vue";
import { createPersistedState, type StorageLike } from "pinia-plugin-persistedstate";
import type { Voice } from "../types";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

const voicesFixture: Voice[] = [
  {
    Name: "Microsoft Server Speech Text to Speech Voice (zh-CN, XiaoxiaoNeural)",
    ShortName: "zh-CN-XiaoxiaoNeural",
    Gender: "Female",
    Locale: "zh-CN",
    SuggestedCodec: "audio-24khz-48kbitrate-mono-mp3",
    FriendlyName: "Xiaoxiao",
    Status: "GA",
    VoiceTag: {
      ContentCategories: ["General"],
      VoicePersonalities: ["Warm"],
    },
  },
  {
    Name: "Microsoft Server Speech Text to Speech Voice (zh-CN, YunxiNeural)",
    ShortName: "zh-CN-YunxiNeural",
    Gender: "Male",
    Locale: "zh-CN",
    SuggestedCodec: "audio-24khz-48kbitrate-mono-mp3",
    FriendlyName: "Yunxi",
    Status: "GA",
    VoiceTag: {
      ContentCategories: ["General"],
      VoicePersonalities: ["Lively"],
    },
  },
  {
    Name: "Microsoft Server Speech Text to Speech Voice (en-US, JennyNeural)",
    ShortName: "en-US-JennyNeural",
    Gender: "Female",
    Locale: "en-US",
    SuggestedCodec: "audio-24khz-48kbitrate-mono-mp3",
    FriendlyName: "Jenny",
    Status: "GA",
    VoiceTag: {
      ContentCategories: ["General"],
      VoicePersonalities: ["Friendly"],
    },
  },
];

function createMemoryStorage(): StorageLike & { clear(): void } {
  const values = new Map<string, string>();

  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    clear() {
      values.clear();
    },
  };
}

describe("useVoicesStore", () => {
  const storage = createMemoryStorage();

  beforeEach(() => {
    invokeMock.mockReset();
    const pinia = createPinia();
    pinia.use(createPersistedState({ storage }));
    createApp({}).use(pinia);
    setActivePinia(pinia);
    storage.clear();
    window.localStorage.clear();
  });

  test("fetches voices and exposes locale-based getters", async () => {
    invokeMock.mockResolvedValue(voicesFixture);
    const { useVoicesStore } = await import("./voices");
    const store = useVoicesStore();

    await store.fetchVoices();

    expect(invokeMock).toHaveBeenCalledWith("get_voices");
    expect(store.voices).toEqual(voicesFixture);
    expect(store.locales).toEqual(["en-US", "zh-CN"]);
    expect(store.filteredVoices.map((voice) => voice.ShortName)).toEqual([
      "zh-CN-XiaoxiaoNeural",
      "zh-CN-YunxiNeural",
    ]);
    expect(store.currentVoice?.ShortName).toBe("zh-CN-XiaoxiaoNeural");
  });

  test("updates selected voice when locale changes", async () => {
    invokeMock.mockResolvedValue(voicesFixture);
    const { useVoicesStore } = await import("./voices");
    const store = useVoicesStore();

    await store.fetchVoices();
    store.setLocale("en-US");

    expect(store.selectedLocale).toBe("en-US");
    expect(store.selectedVoice).toBe("en-US-JennyNeural");
    expect(store.filteredVoices).toHaveLength(1);
  });

  test("falls back to the first available voice when persisted selection is missing", async () => {
    invokeMock.mockResolvedValue(voicesFixture);
    const { useVoicesStore } = await import("./voices");
    const store = useVoicesStore();

    store.$patch({
      selectedLocale: "ja-JP",
      selectedVoice: "ja-JP-NanamiNeural",
    });

    await store.fetchVoices();

    expect(store.selectedLocale).toBe("zh-CN");
    expect(store.selectedVoice).toBe("zh-CN-XiaoxiaoNeural");
  });

  test("rehydrates persisted locale and voice selection", async () => {
    invokeMock.mockResolvedValue(voicesFixture);
    const { useVoicesStore } = await import("./voices");
    const store = useVoicesStore();

    await store.fetchVoices();
    store.setLocale("en-US");
    store.setVoice("en-US-JennyNeural");

    const nextPinia = createPinia();
    nextPinia.use(createPersistedState({ storage }));
    createApp({}).use(nextPinia);
    setActivePinia(nextPinia);

    const rehydratedStore = useVoicesStore();

    expect(rehydratedStore.selectedLocale).toBe("en-US");
    expect(rehydratedStore.selectedVoice).toBe("en-US-JennyNeural");
  });

  test("ignores unknown locale updates to keep state consistent", async () => {
    invokeMock.mockResolvedValue(voicesFixture);
    const { useVoicesStore } = await import("./voices");
    const store = useVoicesStore();

    await store.fetchVoices();
    store.setLocale("unknown-locale");

    expect(store.selectedLocale).toBe("zh-CN");
    expect(store.selectedVoice).toBe("zh-CN-XiaoxiaoNeural");
    expect(store.filteredVoices.map((voice) => voice.ShortName)).toEqual([
      "zh-CN-XiaoxiaoNeural",
      "zh-CN-YunxiNeural",
    ]);
  });

  test("ignores unknown voice updates to keep state consistent", async () => {
    invokeMock.mockResolvedValue(voicesFixture);
    const { useVoicesStore } = await import("./voices");
    const store = useVoicesStore();

    await store.fetchVoices();
    store.setVoice("unknown-voice");

    expect(store.selectedLocale).toBe("zh-CN");
    expect(store.selectedVoice).toBe("zh-CN-XiaoxiaoNeural");
    expect(store.currentVoice?.ShortName).toBe("zh-CN-XiaoxiaoNeural");
  });

  test("stores a readable error when voice loading fails", async () => {
    invokeMock.mockRejectedValue(new Error("network unavailable"));
    const { useVoicesStore } = await import("./voices");
    const store = useVoicesStore();

    await store.fetchVoices();

    expect(store.error).toContain("network unavailable");
    expect(store.usingCache).toBe(false);
    expect(store.voices).toEqual([]);
    expect(store.loading).toBe(false);
  });

  test("falls back to the cached voice list when the service is unavailable", async () => {
    invokeMock.mockResolvedValueOnce(voicesFixture);
    const { useVoicesStore } = await import("./voices");
    await useVoicesStore().fetchVoices();

    invokeMock.mockRejectedValue(new Error("network unavailable"));
    const nextPinia = createPinia();
    nextPinia.use(createPersistedState({ storage }));
    createApp({}).use(nextPinia);
    setActivePinia(nextPinia);

    const store = useVoicesStore();
    await store.fetchVoices();

    expect(store.usingCache).toBe(true);
    expect(store.voices).toEqual(voicesFixture);
    expect(store.cacheSavedAt).toBeTypeOf("number");
    expect(store.error).toContain("network unavailable");
  });

  test("toggles favorites and sorts favorites to top of filtered voices", async () => {
    invokeMock.mockResolvedValue(voicesFixture);
    const { useVoicesStore } = await import("./voices");
    const store = useVoicesStore();

    await store.fetchVoices();
    expect(store.isFavorite("zh-CN-YunxiNeural")).toBe(false);

    store.toggleFavorite("zh-CN-YunxiNeural");
    expect(store.isFavorite("zh-CN-YunxiNeural")).toBe(true);
    expect(store.favorites).toEqual(["zh-CN-YunxiNeural"]);

    // Yunxi should now be first in filteredVoices because it is favorited
    expect(store.filteredVoices[0]?.ShortName).toBe("zh-CN-YunxiNeural");

    store.toggleFavorite("zh-CN-YunxiNeural");
    expect(store.isFavorite("zh-CN-YunxiNeural")).toBe(false);
    expect(store.favorites).toEqual([]);
  });
});
