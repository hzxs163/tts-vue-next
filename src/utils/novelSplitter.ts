import type {
  ChapterSplitPreset,
  NovelChapter,
  SplitNovelOptions,
  SplitNovelResult,
} from "../types";

export const DEFAULT_CHAPTER_PRESETS: ChapterSplitPreset[] = [
  {
    id: "webNovel",
    name: "现代网络小说 (含引子/楔子/尾声/番外)",
    pattern:
      "^\\s*(?:(?:第\\s*[0-9一二三四五六七八九十百千万零两]+\\s*[章回卷节集篇部]|卷[0-9一二三四五六七八九十百千万零两]+)|Chapter\\s*\\d+|引子|序言|楔子|尾声|番外|后记).{0,60}$",
  },
  {
    id: "standard",
    name: "标准中文章节 (第X章/回/节/卷/篇/集)",
    pattern:
      "^\\s*(?:第\\s*[0-9一二三四五六七八九十百千万零两]+\\s*[章回卷节集篇部]|卷[0-9一二三四五六七八九十百千万零两]+).{0,60}$",
  },
  {
    id: "numbered",
    name: "纯数字序号 (1. / 1、 / (1) / 【1】)",
    pattern: "^\\s*(?:\\d+[、\\.．\\s]|\\(\\d+\\)|【\\d+】|\\[\\d+\\]).{0,60}$",
  },
  {
    id: "english",
    name: "英文章节 (Chapter / Section / Episode)",
    pattern: "^\\s*(?:Chapter|Section|Episode|Act|Part)\\s+\\d+.*$",
  },
  {
    id: "custom",
    name: "自定义正则表达式",
    pattern: "",
  },
];

export const DEFAULT_AD_PATTERNS: string[] = [
  "https?:\\/\\/\\S+",
  "www\\.[a-zA-Z0-9_.-]+\\.[a-zA-Z]{2,}",
  "(?:求月票|求推荐|求收藏|求订阅|求追读|求打赏|求全订|求赞赏|投月票|投推荐票)",
  "(?:书友群|官方群|交流群|读者群|企鹅群|QQ群|微信公众号|vx群|关注公众号)",
  "(?:防盗章节|防盗版|首发于|更新最快|笔趣阁|最新域名|请牢记|永久网址|本站域名|看书阁|起点中文网)",
  "(?:本章未完|点击下一页|继续阅读|翻页|未完待续)",
];

const BRACKETED_AD_REGEX =
  /[（(【\x5b][^）)】\x5d]*(?:求月票|求推荐|求收藏|求订阅|关注公众号|微信|书友群|未完待续)[^）)】\x5d]*[）)】\x5d]/g;

function padNumber(num: number, total: number): string {
  const digits = total >= 1000 ? 4 : total >= 100 ? 3 : 2;
  return String(num).padStart(digits, "0");
}

/**
 * Format chapter title with zero-padded number if requested.
 * E.g., "第1章 初入江湖" -> "第001章 初入江湖"
 */
export function formatPaddedChapterTitle(title: string, index: number, total: number): string {
  const padded = padNumber(index, total);
  // If title starts with "第X章", replace with "第00X章"
  const standardPrefix = /^(\s*第\s*)(\d+)(\s*[章回卷节集篇部])/;
  if (standardPrefix.test(title)) {
    return title.replace(standardPrefix, `$1${padded}$3`).trim();
  }
  // If title starts with a number like "1. ", replace with "001. "
  const numberPrefix = /^(\s*)(\d+)([、.．\s])/;
  if (numberPrefix.test(title)) {
    return title.replace(numberPrefix, `$1${padded}$3`).trim();
  }
  // Otherwise, prefix with formatted index
  return `[${padded}] ${title.trim()}`;
}

/**
 * Cleans ad lines, watermark brackets, and excessive blank lines from text.
 */
export function cleanContent(
  text: string,
  adPatterns: string[] = DEFAULT_AD_PATTERNS,
): { cleaned: string; removedLines: number } {
  if (!text) {
    return { cleaned: "", removedLines: 0 };
  }

  const compiledRegexes: RegExp[] = [];
  for (const pattern of adPatterns) {
    try {
      compiledRegexes.push(new RegExp(pattern, "i"));
    } catch {
      // Ignore invalid regex
    }
  }

  const lines = text.split(/\r?\n/);
  const retainedLines: string[] = [];
  let removedLines = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      retainedLines.push("");
      continue;
    }

    // First strip bracketed ads
    const strippedBrackets = trimmed.replace(BRACKETED_AD_REGEX, "").trim();
    if (!strippedBrackets) {
      removedLines += 1;
      continue;
    }

    // Check if entire line matches an ad pattern
    const isAd = compiledRegexes.some((regex) => regex.test(strippedBrackets));
    if (isAd) {
      removedLines += 1;
      continue;
    }

    retainedLines.push(strippedBrackets);
  }

  // Normalize consecutive blank lines to double newlines
  const joined = retainedLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { cleaned: joined, removedLines };
}

/**
 * Fallback chunker when no chapter patterns match.
 * Chunks text every ~chunkSize characters, breaking cleanly on sentences or paragraphs.
 */
function chunkText(text: string, chunkSize = 4000): NovelChapter[] {
  const chapters: NovelChapter[] = [];
  let currentIndex = 0;
  let part = 1;

  while (currentIndex < text.length) {
    let nextIndex = currentIndex + chunkSize;
    if (nextIndex >= text.length) {
      nextIndex = text.length;
    } else {
      // Find sentence or paragraph break within a 500-char window
      const searchWindow = text.slice(
        Math.max(currentIndex, nextIndex - 400),
        Math.min(text.length, nextIndex + 400),
      );
      const breakMatch = searchWindow.match(/[\n\r]+|[。！？!?]\s*/);
      if (breakMatch && breakMatch.index !== undefined) {
        nextIndex =
          Math.max(currentIndex, nextIndex - 400) + breakMatch.index + breakMatch[0].length;
      }
    }

    const chunk = text.slice(currentIndex, nextIndex).trim();
    if (chunk) {
      chapters.push({
        id: crypto.randomUUID(),
        index: part,
        title: `第 ${part} 部分`,
        rawTitle: `第 ${part} 部分`,
        content: chunk,
        charCount: chunk.length,
        selected: true,
      });
      part += 1;
    }

    currentIndex = nextIndex;
  }

  return chapters;
}

/**
 * Splits a novel text into chapters with optional ad cleaning and number padding.
 */
export function splitNovel(rawText: string, options: SplitNovelOptions = {}): SplitNovelResult {
  const {
    presetId = "webNovel",
    customPattern = "",
    cleanAds = true,
    customAdPatterns,
    padChapterIndex = true,
    minChapterLength = 20,
    discardEmptyPrologue = true,
    fallbackChunkSize = 4000,
    novelTitle = "",
  } = options;

  let patternStr: string;
  if (presetId === "custom") {
    patternStr = customPattern;
  } else {
    const preset = DEFAULT_CHAPTER_PRESETS.find((p) => p.id === presetId);
    patternStr = preset ? preset.pattern : DEFAULT_CHAPTER_PRESETS[0].pattern;
  }

  let chapterRegex: RegExp | null = null;
  if (patternStr) {
    try {
      chapterRegex = new RegExp(patternStr, "m");
    } catch {
      chapterRegex = null;
    }
  }

  const effectiveAdPatterns = customAdPatterns ?? DEFAULT_AD_PATTERNS;
  let totalAdLinesRemoved = 0;

  // If no regex could be compiled, fallback to chunking
  if (!chapterRegex) {
    const { cleaned, removedLines } = cleanAds
      ? cleanContent(rawText, effectiveAdPatterns)
      : { cleaned: rawText.trim(), removedLines: 0 };
    const chunks = chunkText(cleaned, fallbackChunkSize);
    return {
      chapters: chunks,
      totalChars: cleaned.length,
      totalChapters: chunks.length,
      adLinesRemoved: removedLines,
      novelTitle,
    };
  }

  const lines = rawText.split(/\r?\n/);
  interface RawChapter {
    title: string;
    lines: string[];
  }

  const rawChapters: RawChapter[] = [];
  let currentTitle = "序章 / 前言";
  let currentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check if line is a chapter heading (must not be overly long, e.g. < 80 characters)
    if (trimmed.length > 0 && trimmed.length <= 80 && chapterRegex.test(trimmed)) {
      if (currentLines.length > 0) {
        rawChapters.push({
          title: currentTitle,
          lines: currentLines,
        });
      }
      currentTitle = trimmed;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    rawChapters.push({
      title: currentTitle,
      lines: currentLines,
    });
  }

  // If only 1 chapter was found or regex didn't match any chapter headers, fallback to chunking if text is large
  if (rawChapters.length <= 1 && rawText.length > fallbackChunkSize) {
    const { cleaned, removedLines } = cleanAds
      ? cleanContent(rawText, effectiveAdPatterns)
      : { cleaned: rawText.trim(), removedLines: 0 };
    const chunks = chunkText(cleaned, fallbackChunkSize);
    return {
      chapters: chunks,
      totalChars: cleaned.length,
      totalChapters: chunks.length,
      adLinesRemoved: removedLines,
      novelTitle,
    };
  }

  const parsedChapters: NovelChapter[] = [];
  let chapterIndex = 1;

  for (let i = 0; i < rawChapters.length; i++) {
    const raw = rawChapters[i];
    const fullText = raw.lines.join("\n");
    const { cleaned, removedLines } = cleanAds
      ? cleanContent(fullText, effectiveAdPatterns)
      : { cleaned: fullText.trim(), removedLines: 0 };

    totalAdLinesRemoved += removedLines;

    // Discard empty/short prologue if requested
    if (
      i === 0 &&
      raw.title.includes("序章") &&
      cleaned.length < minChapterLength &&
      discardEmptyPrologue
    ) {
      continue;
    }

    if (cleaned.length < minChapterLength) {
      continue;
    }

    parsedChapters.push({
      id: crypto.randomUUID(),
      index: chapterIndex,
      title: raw.title,
      rawTitle: raw.title,
      content: cleaned,
      charCount: cleaned.length,
      selected: true,
    });

    chapterIndex += 1;
  }

  // Format titles if padding requested
  if (padChapterIndex) {
    const total = parsedChapters.length;
    parsedChapters.forEach((ch, idx) => {
      ch.title = formatPaddedChapterTitle(ch.title, idx + 1, total);
    });
  }

  const totalChars = parsedChapters.reduce((sum, ch) => sum + ch.charCount, 0);

  return {
    chapters: parsedChapters,
    totalChars,
    totalChapters: parsedChapters.length,
    adLinesRemoved: totalAdLinesRemoved,
    novelTitle,
  };
}
