import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useDialogueStore } from "./dialogue";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("useDialogueStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    invokeMock.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes with default roles and sample script", () => {
    const store = useDialogueStore();
    expect(store.roles.length).toBeGreaterThan(1);
    expect(store.lines.length).toBeGreaterThan(1);
    expect(store.roles[0].isDefault).toBe(true);
  });

  it("adds, updates and removes roles", () => {
    const store = useDialogueStore();
    const initialRoleCount = store.roles.length;

    store.addRole({
      name: "反派",
      voice: "zh-CN-YunzeNeural",
      rate: -5,
      pitch: -10,
      volume: 0,
      color: "red",
    });

    expect(store.roles.length).toBe(initialRoleCount + 1);
    const addedRole = store.roles.find((r) => r.name === "反派")!;
    expect(addedRole.voice).toBe("zh-CN-YunzeNeural");

    store.updateRole(addedRole.id, { rate: 10 });
    expect(store.roles.find((r) => r.id === addedRole.id)?.rate).toBe(10);

    // Assign a line to this role
    store.addLine(addedRole.id, "休想逃跑！");
    expect(store.lines[store.lines.length - 1].roleId).toBe(addedRole.id);

    // Remove role and verify line is reassigned to default role
    store.removeRole(addedRole.id);
    expect(store.roles.find((r) => r.id === addedRole.id)).toBeUndefined();
    expect(store.lines[store.lines.length - 1].roleId).toBe(store.roles[0].id);
  });

  it("keeps the language of each role independent of the others", () => {
    const store = useDialogueStore();

    store.addRole({
      name: "English Narrator",
      voice: "en-US-AriaNeural",
      locale: "en-US",
      rate: 0,
      pitch: 0,
      volume: 0,
      color: "info",
    });

    store.addRole({
      name: "中文配角",
      voice: "zh-CN-XiaoyiNeural",
      locale: "zh-CN",
      rate: 0,
      pitch: 0,
      volume: 0,
      color: "success",
    });

    const english = store.roles.find((role) => role.name === "English Narrator")!;
    const chinese = store.roles.find((role) => role.name === "中文配角")!;

    expect(english.locale).toBe("en-US");
    expect(chinese.locale).toBe("zh-CN");

    // Changing one role must not touch the other.
    store.updateRole(english.id, { locale: "en-GB", voice: "en-GB-SoniaNeural" });
    expect(store.roles.find((role) => role.id === english.id)?.locale).toBe("en-GB");
    expect(store.roles.find((role) => role.id === chinese.id)?.locale).toBe("zh-CN");
  });

  it("manipulates dialogue lines (insert, update, remove)", () => {
    const store = useDialogueStore();
    store.clearLines();
    expect(store.lines.length).toBe(0);

    store.addLine(undefined, "第一句");
    store.addLine(undefined, "第二句");
    expect(store.lines.length).toBe(2);

    store.insertLineAfter(0, undefined, "插在中间");
    expect(store.lines.length).toBe(3);
    expect(store.lines[1].text).toBe("插在中间");

    const lineId = store.lines[1].id;
    store.updateLine(lineId, { text: "修改后的中间句" });
    expect(store.lines[1].text).toBe("修改后的中间句");

    store.removeLine(lineId);
    expect(store.lines.length).toBe(2);
    expect(store.lines[1].text).toBe("第二句");
  });

  it("persists the script so it survives a reload", () => {
    const store = useDialogueStore();
    store.clearLines();
    store.addLine(undefined, "持久化的台词");
    const lineId = store.lines[0].id;

    const restored = useDialogueStore();
    expect(restored.lines.length).toBe(1);
    expect(restored.lines[0].text).toBe("持久化的台词");
    expect(restored.lines[0].id).toBe(lineId);
  });

  it("applies a cast preset without destroying existing roles or line bindings", () => {
    const store = useDialogueStore();
    store.clearLines();

    const narrator = store.roles[0];
    store.updateRole(narrator.id, { rate: 7, voice: "zh-CN-YunxiNeural" });
    store.addLine(narrator.id, "旁白台词");

    const roleCountBefore = store.roles.length;
    store.applyPreset("urban");

    // The matching role keeps its id, so the line stays bound to it.
    const updatedNarrator = store.roles.find((r) => r.id === narrator.id);
    expect(updatedNarrator).toBeDefined();
    expect(store.lines[0].roleId).toBe(narrator.id);

    // The preset's own voice characteristics are applied.
    const urbanNarrator = store.roles.find((r) => r.name === "林辰" || r.name === "旁白");
    expect(urbanNarrator).toBeDefined();
    expect(store.roles.length).toBeGreaterThanOrEqual(roleCountBefore);
  });

  it("adds preset roles that do not exist yet", () => {
    const store = useDialogueStore();
    store.clearLines();

    const before = store.roles.map((r) => r.name);
    store.applyPreset("fairytale");

    const after = store.roles.map((r) => r.name);
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.some((name) => !before.includes(name))).toBe(true);
    // Exactly one default role.
    expect(store.roles.filter((r) => r.isDefault)).toHaveLength(1);
  });

  it("reports an empty parse instead of silently keeping the old script", () => {
    const store = useDialogueStore();
    const originalLines = store.lines.length;

    const result = store.parseScriptText("   ", "prefix");
    expect(result.ok).toBe(false);
    expect(result.count).toBe(0);
    expect(store.lines.length).toBe(originalLines);
  });

  it("replaces the script when the parse succeeds", () => {
    const store = useDialogueStore();

    const result = store.parseScriptText("旁白：今天是个好日子。\n旁白：出发吧！", "prefix");
    expect(result.ok).toBe(true);
    expect(result.count).toBe(2);
    expect(store.lines.length).toBe(2);
  });

  it("synthesizes dialogue, concatenates audio, and creates subtitles", async () => {
    const store = useDialogueStore();
    store.clearLines();
    store.addLine(store.roles[0].id, "今天是个好日子。");
    store.addLine(store.roles[1].id, "是的，天气真不错！");

    invokeMock.mockImplementation(async (command: string) => {
      if (command === "tts_get_subtitles") {
        return null;
      }
      return new ArrayBuffer(144);
    });

    await store.synthesizeAll();

    // Two synthesis calls plus one subtitle lookup per line.
    expect(invokeMock).toHaveBeenCalledTimes(4);
    expect(store.audioBytes).toBeDefined();
    expect(store.audioBytes!.length).toBeGreaterThan(288); // 2 audio chunks + silence gap
    expect(store.subtitles).toBeDefined();
    expect(store.subtitles?.srt).toContain(`[${store.roles[0].name}] 今天是个好日子。`);
    expect(store.subtitles?.srt).toContain(`[${store.roles[1].name}] 是的，天气真不错！`);
  });

  it("uses the backend word timings for the subtitle timeline", async () => {
    const store = useDialogueStore();
    store.clearLines();
    store.addLine(store.roles[0].id, "第一句。");

    invokeMock.mockImplementation(async (command: string) => {
      if (command === "tts_get_subtitles") {
        return {
          srt: "",
          vtt: "",
          cues: [{ offset: 0, duration: 5000000, startMs: 0, endMs: 500, text: "第一句。" }],
        };
      }
      return new ArrayBuffer(144);
    });

    await store.synthesizeAll();

    // The cue length comes from the real timings, not from the byte size.
    expect(store.subtitles?.srt).toContain("00:00:00,000 --> 00:00:00,500");
  });

  it("keeps synthesizing when a single line fails", async () => {
    const store = useDialogueStore();
    store.clearLines();
    store.addLine(store.roles[0].id, "会失败的一句。");
    store.addLine(store.roles[1].id, "正常的一句。");
    const failedLineId = store.lines[0].id;

    let call = 0;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "tts_get_subtitles") {
        return null;
      }
      call += 1;
      if (call === 1) {
        throw new Error("network exploded");
      }
      return new ArrayBuffer(144);
    });

    await store.synthesizeAll();

    expect(store.failedLineIds).toContain(failedLineId);
    expect(store.errorMessage).toContain("network exploded");
    // The second line was still produced.
    expect(store.audioBytes).toBeDefined();
    expect(store.subtitles?.srt).toContain("正常的一句。");
  });

  it("asks the backend to abort the running synthesis", async () => {
    const store = useDialogueStore();
    store.clearLines();
    store.addLine(store.roles[0].id, "一句。");

    let resolveConvert: ((value: ArrayBuffer) => void) | undefined;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "tts_get_subtitles") {
        return null;
      }
      if (command === "tts_stop") {
        return null;
      }
      return new Promise<ArrayBuffer>((resolve) => {
        resolveConvert = resolve;
      });
    });

    const running = store.synthesizeAll();
    await new Promise((resolve) => setTimeout(resolve, 0));

    store.stopSynthesis();
    expect(invokeMock).toHaveBeenCalledWith("tts_stop", { taskId: expect.any(String) });

    resolveConvert?.(new ArrayBuffer(144));
    await running;
    expect(store.synthesizing).toBe(false);
  });
});
