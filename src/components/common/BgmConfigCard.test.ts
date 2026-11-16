// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent } from "vue";
import i18n from "../../plugins/i18n";
import { useBgmStore } from "../../stores/bgm";
import BgmConfigCard from "./BgmConfigCard.vue";

const cardStub = defineComponent({
  template: "<section class='v-card-stub'><slot /></section>",
});

const cardItemStub = defineComponent({
  template: '<div><slot /><slot name="prepend" /><slot name="append" /></div>',
});

const buttonStub = defineComponent({
  props: {
    disabled: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["click"],
  template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});

const switchStub = defineComponent({
  props: ["modelValue"],
  emits: ["update:modelValue"],
  template:
    '<input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
});

const sliderStub = defineComponent({
  props: ["modelValue"],
  emits: ["update:modelValue"],
  template:
    '<input type="range" :value="modelValue" @input="$emit(\'update:modelValue\', Number($event.target.value))" />',
});

const dividerStub = defineComponent({
  template: "<hr />",
});

const iconStub = defineComponent({
  template: "<span class='v-icon-stub' />",
});

const avatarStub = defineComponent({
  template: "<div><slot /></div>",
});

const btnToggleStub = defineComponent({
  props: ["modelValue"],
  emits: ["update:modelValue"],
  template: "<div class='btn-toggle-stub'><slot /></div>",
});

describe("BgmConfigCard", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    i18n.global.locale.value = "zh";
  });

  function mountComponent() {
    return mount(BgmConfigCard, {
      global: {
        plugins: [i18n],
        stubs: {
          "v-card": cardStub,
          "v-card-item": cardItemStub,
          "v-card-title": defineComponent({ template: "<h3><slot /></h3>" }),
          "v-card-subtitle": defineComponent({ template: "<p><slot /></p>" }),
          "v-btn": buttonStub,
          "v-switch": switchStub,
          "v-slider": sliderStub,
          "v-divider": dividerStub,
          "v-icon": iconStub,
          "v-avatar": avatarStub,
          "v-btn-toggle": btnToggleStub,
          "v-expand-transition": defineComponent({ template: "<div><slot /></div>" }),
        },
      },
    });
  }

  it("renders card title and toggle switch", () => {
    const wrapper = mountComponent();
    expect(wrapper.text()).toContain("背景音乐");
  });

  it("shows expanded controls when enabled", async () => {
    const bgmStore = useBgmStore();
    bgmStore.setEnabled(true);
    const wrapper = mountComponent();

    expect(wrapper.text()).toContain("背景音乐音量");
    expect(wrapper.text()).toContain("人声避让");
    expect(wrapper.text()).toContain("结尾淡出");
  });

  it("displays file name when BGM is chosen", async () => {
    const bgmStore = useBgmStore();
    bgmStore.setEnabled(true);
    bgmStore.setBgmFile("C:\\bgm\\lofi.mp3", "lofi.mp3");
    const wrapper = mountComponent();

    expect(wrapper.text()).toContain("lofi.mp3");
  });
});
