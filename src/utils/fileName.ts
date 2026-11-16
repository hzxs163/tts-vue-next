import type { FileNamePattern } from "../types";

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|\r\n\t]/g;
const PAUSE_TAG_REGEX = /(?:\[|【)(?:停顿|pause)[\s\S]*?(?:\]|】)|<[^>]+>/gi;
const MAX_CONTENT_LENGTH = 20;

export function formatTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const yyyy = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}${MM}${dd}_${hh}${mm}${ss}`;
}

export function sanitizeContentForFileName(
  text: string,
  maxLength: number = MAX_CONTENT_LENGTH,
): string {
  const stripped = text
    .replace(PAUSE_TAG_REGEX, "")
    .replace(INVALID_FILENAME_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!stripped) {
    return "";
  }

  // Multi-byte Unicode / Emoji character safety
  const chars = Array.from(stripped);
  return chars.slice(0, maxLength).join("").trim();
}

export interface BuildFileNameOptions {
  text?: string;
  pattern?: FileNamePattern;
  ext: string;
  defaultBase: string;
  date?: Date;
}

export function buildDefaultFileName(options: BuildFileNameOptions): string {
  const { text = "", pattern = "content", ext, defaultBase, date = new Date() } = options;
  const timestamp = formatTimestamp(date);
  const cleanExt = ext.replace(/^\./, "");

  let baseName: string;

  switch (pattern) {
    case "content": {
      const content = sanitizeContentForFileName(text);
      baseName = content || timestamp;
      break;
    }
    case "timestamp": {
      baseName = timestamp;
      break;
    }
    case "content_timestamp": {
      const content = sanitizeContentForFileName(text, 15);
      baseName = content ? `${content}_${timestamp}` : timestamp;
      break;
    }
    case "default":
    default: {
      baseName = defaultBase;
      break;
    }
  }

  return `${baseName}.${cleanExt}`;
}
