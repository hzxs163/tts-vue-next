import { describe, expect, it } from "vitest";
import { formatScript, parseScript } from "./dialogueParser";
import type { DialogueRole } from "../types";

const testRoles: DialogueRole[] = [
  {
    id: "role-narrator",
    name: "旁白",
    voice: "zh-CN-YunyangNeural",
    rate: 0,
    pitch: 0,
    volume: 0,
    color: "primary",
    isDefault: true,
  },
  {
    id: "role-male",
    name: "萧炎",
    voice: "zh-CN-YunxiNeural",
    rate: 5,
    pitch: 0,
    volume: 0,
    color: "info",
  },
  {
    id: "role-master",
    name: "药老",
    voice: "zh-CN-YunjianNeural",
    rate: -5,
    pitch: -10,
    volume: 0,
    color: "warning",
  },
];

describe("dialogueParser", () => {
  it("parses prefixed script lines with colon or brackets", () => {
    const raw = `
旁白：夕阳西下，断肠人在天涯。
萧炎：“老师，前面便是乌坦城。”
[药老] 此地纳兰家耳目众多，小心行事。
【萧炎】 弟子明白！
未标记的一句话直接当作旁白。
`;

    const lines = parseScript(raw, testRoles);
    expect(lines.length).toBe(5);

    expect(lines[0].roleId).toBe("role-narrator");
    expect(lines[0].text).toBe("夕阳西下，断肠人在天涯。");

    expect(lines[1].roleId).toBe("role-male");
    expect(lines[1].text).toBe("“老师，前面便是乌坦城。”");

    expect(lines[2].roleId).toBe("role-master");
    expect(lines[2].text).toBe("此地纳兰家耳目众多，小心行事。");

    expect(lines[3].roleId).toBe("role-male");
    expect(lines[3].text).toBe("弟子明白！");

    expect(lines[4].roleId).toBe("role-narrator");
    expect(lines[4].text).toBe("未标记的一句话直接当作旁白。");
  });

  it("parses novel paragraphs with quoted dialogue", () => {
    const novelText = `少年握紧双拳，冷笑道：“莫欺少年穷！”随后转身离去。`;

    const lines = parseScript(novelText, testRoles, { mode: "quotes" });
    expect(lines.length).toBe(3);

    expect(lines[0].roleId).toBe("role-narrator");
    expect(lines[0].text).toBe("少年握紧双拳，冷笑道：");

    expect(lines[1].roleId).toBe("role-male");
    expect(lines[1].text).toBe("“莫欺少年穷！”");

    expect(lines[2].roleId).toBe("role-narrator");
    expect(lines[2].text).toBe("随后转身离去。");
  });

  it("formats dialogue lines back to script string", () => {
    const lines = [
      { id: "1", roleId: "role-narrator", text: "天色渐暗。" },
      { id: "2", roleId: "role-male", text: "走吧。" },
    ];

    const formatted = formatScript(lines, testRoles);
    expect(formatted).toBe("旁白：天色渐暗。\n萧炎：走吧。");
  });

  it("returns empty array for empty inputs", () => {
    expect(parseScript("", testRoles)).toEqual([]);
    expect(parseScript("   ", testRoles)).toEqual([]);
    expect(parseScript("旁白：测试", [])).toEqual([]);
  });
});
