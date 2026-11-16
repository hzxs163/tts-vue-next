// @vitest-environment happy-dom

import { describe, expect, test } from "vitest";
import { MDI_SUBSET_ICONS } from "./mdi-subset.icons";

const vueSources = import.meta.glob("../**/*.vue", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const tsSources = import.meta.glob("../**/*.{ts,mjs}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * Matches an icon name that is not part of a longer word. Without the
 * lookbehind, paths such as "generate-mdi-subset.py" would be picked up.
 */
const ICON_RE = /(?<![\w-])mdi-[a-z0-9-]+/g;

/**
 * TypeScript references an icon as a quoted string, e.g. `icon: "mdi-play"`.
 * Requiring the quotes keeps import paths such as "../styles/mdi-subset.css"
 * out of the result.
 */
const QUOTED_ICON_RE = /["'`](mdi-[a-z0-9-]+)["'`]/g;

describe("mdi icon subset", () => {
  const available = new Set<string>(MDI_SUBSET_ICONS);

  test("provides every icon referenced by a template", () => {
    const missing = new Map<string, Set<string>>();

    for (const [file, source] of Object.entries(vueSources)) {
      for (const match of source.matchAll(ICON_RE)) {
        const icon = match[0];
        if (available.has(icon)) {
          continue;
        }
        if (!missing.has(icon)) {
          missing.set(icon, new Set());
        }
        missing.get(icon)!.add(file);
      }
    }

    const details = [...missing.entries()]
      .map(([icon, files]) => `${icon} (${[...files].join(", ")})`)
      .join(", ");

    // An icon that is not part of the subset font renders as blank space,
    // which silently breaks the look of every button that uses it.
    expect(details).toBe("");
  });

  test("provides every icon referenced from TypeScript", () => {
    const missing = new Set<string>();

    for (const source of Object.values(tsSources)) {
      for (const match of source.matchAll(QUOTED_ICON_RE)) {
        if (!available.has(match[1])) {
          missing.add(match[1]);
        }
      }
    }

    expect([...missing].join(", ")).toBe("");
  });

  test("keeps the subset small enough to be worth shipping", () => {
    // The whole point of the subset is to avoid shipping the full MDI font.
    expect(available.size).toBeGreaterThan(50);
    expect(available.size).toBeLessThan(200);
  });
});
