import { describe, expect, it } from "vitest";
import {
  cleanContent,
  formatPaddedChapterTitle,
  splitNovel,
  DEFAULT_AD_PATTERNS,
} from "./novelSplitter";

describe("novelSplitter", () => {
  describe("formatPaddedChapterTitle", () => {
    it("pads standard Chinese chapter numbers", () => {
      expect(formatPaddedChapterTitle("第1章 修仙之旅", 1, 50)).toBe("第01章 修仙之旅");
      expect(formatPaddedChapterTitle("第9章 突破筑基", 9, 200)).toBe("第009章 突破筑基");
      expect(formatPaddedChapterTitle("第15回 激战黑风山", 15, 1000)).toBe("第0015回 激战黑风山");
    });

    it("pads numbered chapter titles", () => {
      expect(formatPaddedChapterTitle("1. 开始", 1, 50)).toBe("01. 开始");
      expect(formatPaddedChapterTitle("2、 进阶", 2, 500)).toBe("002、 进阶");
    });

    it("prefixes non-standard titles with index", () => {
      expect(formatPaddedChapterTitle("引子 神秘古玉", 1, 20)).toBe("[01] 引子 神秘古玉");
    });
  });

  describe("cleanContent", () => {
    it("removes standalone ad lines", () => {
      const raw = [
        "第一段正文内容。",
        "最新网址：www.biquge.com",
        "第二段正文内容。",
        "求月票，求推荐票！",
        "书友群：123456789，欢迎加入！",
        "第三段正文内容。",
      ].join("\n");

      const { cleaned, removedLines } = cleanContent(raw, DEFAULT_AD_PATTERNS);
      expect(removedLines).toBe(3);
      expect(cleaned).toContain("第一段正文内容。");
      expect(cleaned).toContain("第二段正文内容。");
      expect(cleaned).toContain("第三段正文内容。");
      expect(cleaned).not.toContain("biquge.com");
      expect(cleaned).not.toContain("求月票");
      expect(cleaned).not.toContain("书友群");
    });

    it("removes bracketed ad markers in the middle of sentences", () => {
      const raw = "主角拔出了宝剑（求月票支持！），斩断了锁链【欢迎关注微信公众号】。";
      const { cleaned } = cleanContent(raw, DEFAULT_AD_PATTERNS);
      expect(cleaned).toBe("主角拔出了宝剑，斩断了锁链。");
    });

    it("normalizes multiple blank lines", () => {
      const raw = "段落一\n\n\n\n\n段落二";
      const { cleaned } = cleanContent(raw);
      expect(cleaned).toBe("段落一\n\n段落二");
    });
  });

  describe("splitNovel", () => {
    it("splits standard Chinese chapters with webNovel preset", () => {
      const novel = `
引子
古老的山脉之中，有一座无名道观。

第1章 初入江湖
少年背负长剑，走出了深山。
求月票支持！
他抬头望向远方，神色坚定。

第2章 遭遇强敌
前方黑风扑面，一名黑衣人拔刀相向。
www.novel.com 最新更新
战斗一触即发！
`;

      const result = splitNovel(novel, {
        presetId: "webNovel",
        cleanAds: true,
        padChapterIndex: true,
        minChapterLength: 10,
      });

      expect(result.totalChapters).toBe(3);
      expect(result.chapters[0].title).toBe("[01] 引子");
      expect(result.chapters[1].title).toBe("第02章 初入江湖");
      expect(result.chapters[2].title).toBe("第03章 遭遇强敌");

      expect(result.chapters[1].content).not.toContain("求月票");
      expect(result.chapters[2].content).not.toContain("novel.com");
      expect(result.adLinesRemoved).toBe(2);
    });

    it("splits English chapters", () => {
      const englishNovel = `
Chapter 1 The Journey Begins
The morning sun rose over the rolling hills of Avalon.

Chapter 2 Into the Dark Forest
The shadows grew longer as the brave adventurer entered the woods.
`;

      const result = splitNovel(englishNovel, {
        presetId: "english",
        cleanAds: false,
        padChapterIndex: false,
        minChapterLength: 10,
      });

      expect(result.totalChapters).toBe(2);
      expect(result.chapters[0].title).toBe("Chapter 1 The Journey Begins");
      expect(result.chapters[1].title).toBe("Chapter 2 Into the Dark Forest");
    });

    it("falls back to smart text chunking if no chapters match", () => {
      // 5000 chars of continuous text without chapter headers
      const text = "这是一段很长的连续小说正文内容，讲述修仙者的故事。".repeat(300);

      const result = splitNovel(text, {
        presetId: "standard",
        fallbackChunkSize: 2000,
      });

      expect(result.totalChapters).toBeGreaterThan(1);
      expect(result.chapters[0].title).toBe("第 1 部分");
    });

    it("handles custom regex pattern", () => {
      const novel = `
【第一卷】 破茧成蝶
这一卷讲述少年的成长故事。

【第二卷】 扶摇直上
少年踏上了真正的修仙之路。
`;

      const result = splitNovel(novel, {
        presetId: "custom",
        customPattern: "^【第[一二三四五]卷】.*$",
        padChapterIndex: false,
        minChapterLength: 5,
      });

      expect(result.totalChapters).toBe(2);
      expect(result.chapters[0].title).toBe("【第一卷】 破茧成蝶");
      expect(result.chapters[1].title).toBe("【第二卷】 扶摇直上");
    });
  });
});
