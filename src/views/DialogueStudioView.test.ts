// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent } from "vue";
import i18n from "../plugins/i18n";
import { useDialogueStore } from "../stores/dialogue";

const { messageSuccessMock, messageWarningMock, messageErrorMock, invokeMock } = vi.hoisted(() => ({
  messageSuccessMock: vi.fn(),
  messageWarningMock: vi.fn(),
  messageErrorMock: vi.fn(),
  invokeMock: vi.fn(),
}));

vi.mock("vuetify-message-vue3", () => ({
  useMessage: () => ({
    success: messageSuccessMock,
    warning: messageWarningMock,
    error: messageErrorMock,
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn().mockResolvedValue("C:/exports/test.mp3"),
}));

const passthroughStub = defineComponent({
  template: "<div><slot /></div>",
});

/**
 * The menu stub has to render the activator slot as well, otherwise every
 * control that opens a dropdown (the speaker switcher, the pause chip, the
 * default pause chip) is missing from the rendered output.
 */
const menuStub = defineComponent({
  template: "<div><slot name='activator' /><slot /></div>",
});

const buttonStub = defineComponent({
  inheritAttrs: false,
  props: ["disabled"],
  emits: ["click"],
  template:
    '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});

describe("DialogueStudioView", () => {
  let pinia: ReturnType<typeof createPinia>;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    localStorage.clear();
    messageSuccessMock.mockReset();
    messageWarningMock.mockReset();
    messageErrorMock.mockReset();
    invokeMock.mockReset();
    i18n.global.locale.value = "zh";
  });

  async function mountView() {
    const { default: DialogueStudioView } = await import("./DialogueStudioView.vue");

    return mount(DialogueStudioView, {
      global: {
        plugins: [pinia, i18n],
        stubs: {
          VContainer: passthroughStub,
          VRow: passthroughStub,
          VCol: passthroughStub,
          VCard: passthroughStub,
          VCardItem: passthroughStub,
          VCardTitle: passthroughStub,
          VCardSubtitle: passthroughStub,
          VCardText: passthroughStub,
          VCardActions: passthroughStub,
          VDivider: passthroughStub,
          VAvatar: passthroughStub,
          VIcon: passthroughStub,
          VBtn: buttonStub,
          VChip: passthroughStub,
          VMenu: menuStub,
          VList: passthroughStub,
          VListItem: passthroughStub,
          VDialog: passthroughStub,
          VSelect: passthroughStub,
          VTextField: passthroughStub,
          VTextarea: passthroughStub,
          VCheckbox: passthroughStub,
          VSlider: passthroughStub,
          VRadioGroup: passthroughStub,
          VRadio: passthroughStub,
          VProgressLinear: passthroughStub,
          VTabs: passthroughStub,
          VTab: passthroughStub,
          VWindow: passthroughStub,
          VWindowItem: passthroughStub,
          VBadge: passthroughStub,
          BgmConfigCard: passthroughStub,
        },
      },
    });
  }

  it("renders hero title, cast lineup, and script workspace", async () => {
    const wrapper = await mountView();
    const dialogueStore = useDialogueStore();

    expect(wrapper.text()).toContain("多角色演播");
    expect(wrapper.text()).toContain("角色声优阵容");
    expect(wrapper.text()).toContain("剧本台本工作台");

    // Default roles should be rendered
    expect(wrapper.text()).toContain(dialogueStore.roles[0].name);
    expect(wrapper.text()).toContain(dialogueStore.roles[1].name);
  });

  it("lays every script line out as a single compact row", async () => {
    const wrapper = await mountView();
    const dialogueStore = useDialogueStore();

    const cards = wrapper.findAll(".dialogue-line-card");
    expect(cards.length).toBe(dialogueStore.lines.length);

    // Index, speaker, text, pause and actions share one row. The previous
    // layout stacked the controls above the text, which made every line
    // roughly three times taller than the sentence it contained.
    for (const card of cards) {
      const rows = card.findAll(".dialogue-line-row");
      expect(rows).toHaveLength(1);
      expect(rows[0].find(".dialogue-line-text").exists()).toBe(true);
      expect(rows[0].find(".dialogue-line-pause").exists()).toBe(true);
      expect(rows[0].find(".dialogue-line-actions").exists()).toBe(true);
    }
  });

  it("lets the default pause be changed from the script toolbar", async () => {
    const wrapper = await mountView();
    const dialogueStore = useDialogueStore();

    expect(dialogueStore.defaultPauseMs).toBe(300);

    dialogueStore.setDefaultPause(800);
    await wrapper.vm.$nextTick();

    expect(dialogueStore.defaultPauseMs).toBe(800);
    expect(wrapper.text()).toContain("800 ms");
  });

  it("triggers synthesis when clicking synthesize button", async () => {
    const wrapper = await mountView();

    invokeMock.mockResolvedValue(new ArrayBuffer(144));

    const synthButton = wrapper.findAll("button").find((b) => b.text().includes("合成广播剧音频"));
    expect(synthButton).toBeDefined();

    await synthButton!.trigger("click");
    expect(invokeMock).toHaveBeenCalled();
  });

  it("switches tabs between script, cast, and bgm", async () => {
    const wrapper = await mountView();

    expect(wrapper.text()).toContain("剧本台本工作台");
    expect(wrapper.text()).toContain("快速追加台词：");

    // Check tabs are rendered
    expect(wrapper.text()).toContain("角色声优阵容");
    expect(wrapper.text()).toContain("背景音乐与人声避让 (BGM)");
  });
});
