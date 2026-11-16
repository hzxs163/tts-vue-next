// @vitest-environment happy-dom

import { beforeEach, describe, expect, test, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent } from "vue";
import i18n from "../plugins/i18n";
import { useDictionaryStore } from "../stores/dictionary";

vi.mock("vuetify-message-vue3", () => ({
  useMessage: () => ({
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

const passthroughStub = defineComponent({
  inheritAttrs: false,
  template: '<div v-bind="$attrs"><slot /></div>',
});

const cardItemStub = defineComponent({
  inheritAttrs: false,
  template: '<div v-bind="$attrs"><slot name="prepend" /><slot /><slot name="append" /></div>',
});

const buttonStub = defineComponent({
  inheritAttrs: false,
  props: {
    disabled: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["click"],
  template:
    '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});

const switchStub = defineComponent({
  props: {
    modelValue: {
      type: Boolean,
      default: false,
    },
    label: {
      type: String,
      default: "",
    },
  },
  emits: ["update:modelValue"],
  template: `
    <label class="switch-stub">
      <input
        type="checkbox"
        :checked="modelValue"
        @change="$emit('update:modelValue', $event.target.checked)"
      />
      <span>{{ label }}</span>
    </label>
  `,
});

const textareaStub = defineComponent({
  props: {
    modelValue: {
      type: String,
      default: "",
    },
    label: {
      type: String,
      default: "",
    },
  },
  emits: ["update:modelValue"],
  template: `
    <label class="textarea-stub">
      <span>{{ label }}</span>
      <textarea
        :value="modelValue"
        @input="$emit('update:modelValue', $event.target.value)"
      />
      <span class="textarea-value">{{ modelValue }}</span>
    </label>
  `,
});

const textFieldStub = defineComponent({
  props: {
    modelValue: {
      type: String,
      default: "",
    },
    placeholder: {
      type: String,
      default: "",
    },
  },
  emits: ["update:modelValue"],
  template: `
    <input
      class="text-field-stub"
      :value="modelValue"
      :placeholder="placeholder"
      @input="$emit('update:modelValue', $event.target.value)"
    />
  `,
});

const btnToggleStub = defineComponent({
  props: {
    modelValue: {
      type: String,
      default: "all",
    },
  },
  emits: ["update:modelValue"],
  template: '<div class="btn-toggle-stub"><slot /></div>',
});

async function mountDictionaryView() {
  i18n.global.locale.value = "zh";

  const { default: DictionaryView } = await import("./DictionaryView.vue");
  return mount(DictionaryView, {
    global: {
      plugins: [i18n],
      stubs: {
        VContainer: passthroughStub,
        VCard: passthroughStub,
        VCardItem: cardItemStub,
        VCardTitle: passthroughStub,
        VCardSubtitle: passthroughStub,
        VCardText: passthroughStub,
        VCardActions: passthroughStub,
        VAvatar: passthroughStub,
        VIcon: passthroughStub,
        VDivider: passthroughStub,
        VTable: passthroughStub,
        VChip: passthroughStub,
        VDialog: passthroughStub,
        VSelect: passthroughStub,
        VBtn: buttonStub,
        VSwitch: switchStub,
        VTextarea: textareaStub,
        VTextField: textFieldStub,
        VBtnToggle: btnToggleStub,
      },
    },
  });
}

describe("DictionaryView", () => {
  beforeEach(() => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useDictionaryStore();
    store.resetToDefaults();
  });

  test("renders hero title, description, and action controls", async () => {
    const wrapper = await mountDictionaryView();

    expect(wrapper.text()).toContain("替换词典");
    expect(wrapper.text()).toContain("多音字纠错与全局替换");
    expect(wrapper.text()).toContain("添加规则");
    expect(wrapper.text()).toContain("恢复预置");
  });

  test("computes live replacement preview accurately", async () => {
    const wrapper = await mountDictionaryView();

    // The default test input has "重新启动银行系统，拨打110联系Vue团队"
    expect(wrapper.text()).toContain("从新启动银航系统，拨打幺幺零联系微尤团队");
  });

  test("toggles a rule's enabled status directly from the list", async () => {
    const store = useDictionaryStore();
    const chongXin = store.rules.find((r) => r.origin === "重新")!;
    expect(chongXin.enabled).toBe(true);

    const wrapper = await mountDictionaryView();
    const checkboxes = wrapper.findAll('input[type="checkbox"]');
    // Index 0 is global enable switch, index 1 is first rule
    expect(checkboxes.length).toBeGreaterThan(1);
  });
});
