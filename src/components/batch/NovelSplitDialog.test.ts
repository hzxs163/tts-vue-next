// @vitest-environment happy-dom

import { beforeEach, describe, expect, test, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent } from "vue";
import i18n from "../../plugins/i18n";
import { useBatchStore } from "../../stores/batch";
import type { NovelChapter } from "../../types";

const { messageSuccessMock } = vi.hoisted(() => ({
  messageSuccessMock: vi.fn(),
}));

vi.mock("vuetify-message-vue3", () => ({
  useMessage: () => ({
    success: messageSuccessMock,
    error: vi.fn(),
  }),
}));

const passthroughStub = defineComponent({
  template: "<div><slot /></div>",
});

const dialogStub = defineComponent({
  props: ["modelValue"],
  emits: ["update:modelValue"],
  template: '<div v-if="modelValue" class="dialog-stub"><slot /></div>',
});

const cardItemStub = defineComponent({
  template: '<div><slot name="prepend" /><slot /><slot name="append" /></div>',
});

const buttonStub = defineComponent({
  inheritAttrs: false,
  props: ["disabled"],
  emits: ["click"],
  template:
    '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});

describe("NovelSplitDialog", () => {
  let pinia: ReturnType<typeof createPinia>;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    messageSuccessMock.mockReset();
    i18n.global.locale.value = "zh";
  });

  async function mountDialog(props: {
    modelValue: boolean;
    filePath?: string;
    fileName?: string;
    fileSize?: string;
    rawContent?: string;
  }) {
    const { default: NovelSplitDialog } = await import("./NovelSplitDialog.vue");

    return mount(NovelSplitDialog, {
      props,
      global: {
        plugins: [pinia, i18n],
        stubs: {
          VDialog: dialogStub,
          VCard: passthroughStub,
          VCardItem: cardItemStub,
          VCardTitle: passthroughStub,
          VCardSubtitle: passthroughStub,
          VCardText: passthroughStub,
          VCardActions: passthroughStub,
          VDivider: passthroughStub,
          VAvatar: passthroughStub,
          VIcon: passthroughStub,
          VBtn: buttonStub,
          VChip: passthroughStub,
          VSelect: passthroughStub,
          VTextField: passthroughStub,
          VCheckbox: passthroughStub,
          VCheckboxBtn: passthroughStub,
          VTable: passthroughStub,
        },
      },
    });
  }

  test("renders novel metadata and splits text into chapters", async () => {
    const rawContent = `
第1章 山边小村
这是一个宁静而偏远的小山村，村民们日出而作日落而息。
求月票支持！

第2章 离家远行
少年背负着长剑与行囊，向着远方的修仙大宗踏上旅程。
`;

    const wrapper = await mountDialog({
      modelValue: true,
      filePath: "C:/novels/test.txt",
      fileName: "test.txt",
      fileSize: "1.2 KB",
      rawContent,
    });

    expect(wrapper.text()).toContain("长篇小说章节智能切分与广告清洗");
    expect(wrapper.text()).toContain("test.txt");
    expect(wrapper.text()).toContain("第01章 山边小村");
    expect(wrapper.text()).toContain("第02章 离家远行");
  });

  test("imports selected chapters into batch store on confirm", async () => {
    const rawContent = `
第1章 第一章
少年走出深山，开启波澜壮阔的修仙世界。

第2章 第二章
宗门大选开启，各路英豪齐聚一堂展露风采。
`;

    const wrapper = await mountDialog({
      modelValue: true,
      filePath: "C:/novels/test.txt",
      fileName: "test.txt",
      fileSize: "1.2 KB",
      rawContent,
    });

    const batchStore = useBatchStore();
    expect(batchStore.files.length).toBe(0);

    // Find the import button (last button with text containing 导入)
    const buttons = wrapper.findAll("button");
    const importBtn = buttons.find((btn) => btn.text().includes("导入"));
    expect(importBtn).toBeDefined();

    await importBtn!.trigger("click");

    expect(batchStore.files.length).toBe(2);
    expect(batchStore.files[0].name).toContain("第01章 第一章");
    expect(batchStore.files[0].content).toContain("少年走出深山");
    expect(messageSuccessMock).toHaveBeenCalledTimes(1);
  });

  test("keeps the user's chapter selection when an option triggers a re-split", async () => {
    const rawContent = `
第1章 第一章
少年走出深山，开启波澜壮阔的修仙世界。

第2章 第二章
宗门大选开启，各路英豪齐聚一堂展露风采。
`;

    const wrapper = await mountDialog({
      modelValue: true,
      filePath: "C:/novels/test.txt",
      fileName: "test.txt",
      fileSize: "1.2 KB",
      rawContent,
    });

    const setup = (wrapper.vm as unknown as { $: { setupState: Record<string, unknown> } }).$
      .setupState as {
      parsedChapters: NovelChapter[];
      toggleChapter: (chapter: NovelChapter, selected: boolean) => void;
      padIndex: boolean;
    };

    expect(setup.parsedChapters.length).toBe(2);

    // The user deselects the first chapter.
    setup.toggleChapter(setup.parsedChapters[0], false);
    expect(setup.parsedChapters[0].selected).toBe(false);
    expect(setup.parsedChapters[1].selected).toBe(true);

    // Changing the number padding re-splits the novel.
    setup.padIndex = false;
    await wrapper.vm.$nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(setup.parsedChapters.length).toBe(2);
    expect(setup.parsedChapters[0].selected).toBe(false);
    expect(setup.parsedChapters[1].selected).toBe(true);
  });
});
