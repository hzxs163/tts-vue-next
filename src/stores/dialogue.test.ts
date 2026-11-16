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

  it("applies cast preset and re-maps lines", () => {
    const store = useDialogueStore();
    store.applyPreset("urban");

    const urbanLead = store.roles.find((r) => r.name === "林辰");
    expect(urbanLead).toBeDefined();
  });

  it("synthesizes dialogue, concatenates audio, and creates subtitles", async () => {
    const store = useDialogueStore();
    store.clearLines();
    store.addLine(store.roles[0].id, "今天是个好日子。");
    store.addLine(store.roles[1].id, "是的，天气真不错！");

    // Return 144 bytes per call
    invokeMock.mockResolvedValue(new ArrayBuffer(144));

    await store.synthesizeAll();

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(store.audioBytes).toBeDefined();
    expect(store.audioBytes!.length).toBeGreaterThan(288); // 2 audio chunks + silence gap
    expect(store.subtitles).toBeDefined();
    expect(store.subtitles?.srt).toContain(`[${store.roles[0].name}] 今天是个好日子。`);
    expect(store.subtitles?.srt).toContain(`[${store.roles[1].name}] 是的，天气真不错！`);
  });
});
