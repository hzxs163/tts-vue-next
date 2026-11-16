import { describe, expect, test } from "vitest";
import en from "./en";
import zh from "./zh";

type Messages = Record<string, unknown>;

function flattenKeys(messages: Messages, prefix = ""): Array<[string, string]> {
  const entries: Array<[string, string]> = [];

  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (value !== null && typeof value === "object") {
      entries.push(...flattenKeys(value as Messages, path));
      continue;
    }

    entries.push([path, String(value)]);
  }

  return entries.sort(([left], [right]) => left.localeCompare(right));
}

describe("locales", () => {
  test("Chinese and English expose exactly the same keys", () => {
    const englishKeys = flattenKeys(en as Messages).map(([key]) => key);
    const chineseKeys = flattenKeys(zh as Messages).map(([key]) => key);

    expect(englishKeys).toEqual(chineseKeys);
  });

  test("no translation is empty", () => {
    for (const [path, value] of flattenKeys(en as Messages)) {
      expect(value.trim(), `en.${path}`).not.toBe("");
    }
    for (const [path, value] of flattenKeys(zh as Messages)) {
      expect(value.trim(), `zh.${path}`).not.toBe("");
    }
  });
});
