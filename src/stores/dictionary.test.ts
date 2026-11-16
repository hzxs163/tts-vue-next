import { beforeEach, describe, expect, test } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createApp } from "vue";
import { useDictionaryStore } from "./dictionary";

describe("useDictionaryStore", () => {
  beforeEach(() => {
    const pinia = createPinia();
    createApp({}).use(pinia);
    setActivePinia(pinia);
  });

  test("initializes with default rules and enabled status", () => {
    const store = useDictionaryStore();
    expect(store.enabled).toBe(true);
    expect(store.rules.length).toBeGreaterThan(15);
    expect(store.rules.some((r) => r.origin === "重新")).toBe(true);
    expect(store.rules.some((r) => r.origin === "110")).toBe(true);
  });

  test("applies default polyphone and number replacements", () => {
    const store = useDictionaryStore();
    const input = "重新启动银行系统，发生意外请拨打110联系Vue官方！";
    const output = store.applyDictionary(input);
    expect(output).toBe("从新启动银航系统，发生意外请拨打幺幺零联系微尤官方！");
  });

  test("preserves pause and break tags during dictionary replacement", () => {
    const store = useDictionaryStore();
    const input = "银行系统[停顿 1s]正在重新加载【停顿 500ms】请耐心等待。";
    const output = store.applyDictionary(input);
    expect(output).toBe("银航系统[停顿 1s]正在从新加载【停顿 500ms】请耐心等待。");
  });

  test("prioritizes longer compound matches over single characters", () => {
    const store = useDictionaryStore();
    store.addRule({
      origin: "重",
      replacement: "Z",
      enabled: true,
      category: "custom",
    });

    const input = "这件事情很重要，我们必须重新处理。";
    const output = store.applyDictionary(input);
    // "重新" should be replaced by "从新", and single "重" replaced by "Z"
    expect(output).toContain("从新");
    expect(output).toContain("Z要");
  });

  test("supports custom regex rules", () => {
    const store = useDictionaryStore();
    store.addRule({
      origin: "第(\\d+)节",
      replacement: "第 $1 回",
      isRegex: true,
      enabled: true,
      category: "custom",
    });

    const input = "请收听第12节的故事。";
    const output = store.applyDictionary(input);
    expect(output).toBe("请收听第 12 回的故事。");
  });

  test("ignores disabled rules and handles global toggle", () => {
    const store = useDictionaryStore();
    const chongXin = store.rules.find((r) => r.origin === "重新")!;
    store.toggleRule(chongXin.id, false);

    expect(store.applyDictionary("重新开始")).toBe("重新开始");

    store.toggleRule(chongXin.id, true);
    expect(store.applyDictionary("重新开始")).toBe("从新开始");

    store.setEnabled(false);
    expect(store.applyDictionary("重新开始")).toBe("重新开始");
  });

  test("supports add, update, and delete rule operations", () => {
    const store = useDictionaryStore();
    const initialCount = store.rules.length;

    store.addRule({
      origin: "测试词汇",
      replacement: "替换词汇",
      enabled: true,
      category: "custom",
    });
    expect(store.rules.length).toBe(initialCount + 1);
    const added = store.rules[0];
    expect(added.origin).toBe("测试词汇");

    store.updateRule(added.id, { replacement: "更新词汇" });
    expect(store.rules[0].replacement).toBe("更新词汇");

    store.deleteRule(added.id);
    expect(store.rules.length).toBe(initialCount);
    expect(store.rules.find((r) => r.id === added.id)).toBeUndefined();
  });

  test("exports and imports rules correctly", () => {
    const store = useDictionaryStore();
    const exportedJson = store.exportRules();
    expect(exportedJson).toContain("重新");

    const imported = [
      {
        id: "imported-1",
        origin: "自定义A",
        replacement: "替换A",
        enabled: true,
      },
    ];

    // Non-overwrite import merges
    store.importRules(imported, false);
    expect(store.rules.some((r) => r.origin === "自定义A")).toBe(true);

    // Reset to defaults
    store.resetToDefaults();
    expect(store.rules.some((r) => r.origin === "自定义A")).toBe(false);
    expect(store.rules.some((r) => r.origin === "重新")).toBe(true);
  });
});
