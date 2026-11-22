// @vitest-environment happy-dom

import { beforeEach, describe, expect, test, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent } from "vue";
import i18n from "../../plugins/i18n";
import VoiceSelector from "./VoiceSelector.vue";
import { useVoicesStore } from "../../stores/voices";
import type { Voice } from "../../types";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

const mockVoices: Voice[] = [
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
      VoicePersonalities: ["Warm"],
    },
  },
];

const passthroughStub = defineComponent({
  inheritAttrs: false,
  template: '<div v-bind="$attrs"><slot /></div>',
});

const buttonStub = defineComponent({
  inheritAttrs: false,
  props: {
    disabled: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
  },
  emits: ["click"],
  template:
    '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});

const selectStub = defineComponent({
  inheritAttrs: false,
  props: {
    items: { type: Array, default: () => [] },
    modelValue: { type: [String, Object], default: "" },
  },
  emits: ["update:modelValue"],
  template: '<div class="v-select-stub"><slot name="prepend-inner" /><slot /></div>',
});

const autocompleteStub = defineComponent({
  inheritAttrs: false,
  props: {
    items: { type: Array, default: () => [] },
    modelValue: { type: [String, Object], default: "" },
  },
  emits: ["update:modelValue"],
  template: '<div class="v-autocomplete-stub"><slot name="item" /></div>',
});

describe("VoiceSelector.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "tts_list_voices") {
        return mockVoices;
      }
      if (cmd === "tts_convert") {
        return new ArrayBuffer(8);
      }
      return null;
    });
  });

  function mountComponent() {
    return mount(VoiceSelector, {
      global: {
        plugins: [i18n],
        stubs: {
          "v-select": selectStub,
          "v-autocomplete": autocompleteStub,
          "v-btn": buttonStub,
          "v-icon": passthroughStub,
        },
      },
    });
  }

  test("loads catalog and renders voice selector controls", async () => {
    const voicesStore = useVoicesStore();
    voicesStore.voices = mockVoices;
    voicesStore.selectedLocale = "zh-CN";
    voicesStore.selectedVoice = "zh-CN-XiaoxiaoNeural";

    const wrapper = mountComponent();
    await flushPromises();

    expect(wrapper.find(".voice-selector").exists()).toBe(true);
    expect(wrapper.find(".voice-selector__actions").exists()).toBe(true);
  });

  test("toggles favorite voice", async () => {
    const voicesStore = useVoicesStore();
    voicesStore.voices = mockVoices;
    voicesStore.selectedVoice = "zh-CN-XiaoxiaoNeural";

    const wrapper = mountComponent();
    await flushPromises();

    expect(voicesStore.isFavorite("zh-CN-XiaoxiaoNeural")).toBe(false);

    const favoriteBtn = wrapper.find(".voice-selector__favorite");
    await favoriteBtn.trigger("click");

    expect(voicesStore.isFavorite("zh-CN-XiaoxiaoNeural")).toBe(true);
  });

  test("cancelling preview invokes tts_stop", async () => {
    const voicesStore = useVoicesStore();
    voicesStore.voices = mockVoices;
    voicesStore.selectedLocale = "zh-CN";
    voicesStore.selectedVoice = "zh-CN-XiaoxiaoNeural";

    let resolveConvert: (buf: ArrayBuffer) => void;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "tts_convert") {
        return new Promise<ArrayBuffer>((res) => {
          resolveConvert = res;
        });
      }
      return Promise.resolve(null);
    });

    const wrapper = mountComponent();
    await flushPromises();

    const previewBtn = wrapper.find(".voice-selector__preview");
    // Start preview (loading state)
    await previewBtn.trigger("click");

    expect(invokeMock).toHaveBeenCalledWith("tts_convert", expect.anything());

    // Click again to cancel
    await previewBtn.trigger("click");

    expect(invokeMock).toHaveBeenCalledWith(
      "tts_stop",
      expect.objectContaining({
        taskId: expect.stringMatching(/^preview-/),
      }),
    );

    // Even if convert resolves later, it shouldn't crash
    resolveConvert!(new ArrayBuffer(8));
    await flushPromises();
  });
});
