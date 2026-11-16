import { describe, expect, test } from "vitest";
import { buildDefaultFileName, formatTimestamp, sanitizeContentForFileName } from "./fileName";

describe("fileName utilities", () => {
  const fixedDate = new Date("2026-11-16T11:13:01");

  test("formats date into sortable YYYYMMDD_HHmmss timestamp", () => {
    expect(formatTimestamp(fixedDate)).toBe("20261116_111301");
  });

  test("sanitizes text content removing pause tags, invalid path chars, and collapses spaces", () => {
    const raw =
      '今天的天气 [停顿 1s]确实不错啊【停顿 500ms】！有雨吗? <break time="2s" />没有/很好*';
    const cleaned = sanitizeContentForFileName(raw, 20);
    expect(cleaned).toBe("今天的天气 确实不错啊！有雨吗 没有 很");
    expect(cleaned.length).toBeLessThanOrEqual(20);
    expect(cleaned).not.toContain("停顿");
    expect(cleaned).not.toContain("?");
    expect(cleaned).not.toContain("/");
    expect(cleaned).not.toContain("*");
  });

  test("builds filename using content pattern by default", () => {
    const fileName = buildDefaultFileName({
      text: "今天的天气[停顿 1s]确实不错啊",
      pattern: "content",
      ext: "mp3",
      defaultBase: "语音输出",
      date: fixedDate,
    });

    expect(fileName).toBe("今天的天气确实不错啊.mp3");
  });

  test("falls back to timestamp when content is empty or only pause tags", () => {
    const fileName = buildDefaultFileName({
      text: "  [停顿 1s] 【pause 2s】  ",
      pattern: "content",
      ext: "mp3",
      defaultBase: "语音输出",
      date: fixedDate,
    });

    expect(fileName).toBe("20261116_111301.mp3");
  });

  test("builds filename using timestamp pattern", () => {
    const fileName = buildDefaultFileName({
      text: "今天的天气确实不错啊",
      pattern: "timestamp",
      ext: "wav",
      defaultBase: "语音输出",
      date: fixedDate,
    });

    expect(fileName).toBe("20261116_111301.wav");
  });

  test("builds filename using content_timestamp pattern", () => {
    const fileName = buildDefaultFileName({
      text: "今天的天气确实不错啊",
      pattern: "content_timestamp",
      ext: "mp3",
      defaultBase: "语音输出",
      date: fixedDate,
    });

    expect(fileName).toBe("今天的天气确实不错啊_20261116_111301.mp3");
  });

  test("builds filename using default base name pattern", () => {
    const fileName = buildDefaultFileName({
      text: "今天的天气确实不错啊",
      pattern: "default",
      ext: "ogg",
      defaultBase: "语音输出",
      date: fixedDate,
    });

    expect(fileName).toBe("语音输出.ogg");
  });

  test("handles extensions with or without leading dot", () => {
    const fileName1 = buildDefaultFileName({
      text: "测试文本",
      pattern: "content",
      ext: ".flac",
      defaultBase: "语音输出",
      date: fixedDate,
    });
    const fileName2 = buildDefaultFileName({
      text: "测试文本",
      pattern: "content",
      ext: "flac",
      defaultBase: "语音输出",
      date: fixedDate,
    });

    expect(fileName1).toBe("测试文本.flac");
    expect(fileName2).toBe("测试文本.flac");
  });
});
