// @vitest-environment happy-dom

import { describe, expect, test } from "vitest";
import pluginSource from "./vuetify.ts?raw";

const vueSources = import.meta.glob("../**/*.vue", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function toComponentName(tag: string): string {
  return `V${tag
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")}`;
}

describe("vuetify plugin registration", () => {
  /**
   * Reads the component names from the `components: { ... }` block only.
   * The import statement at the top of the file lists the same names, so
   * matching the whole file would consider every imported component as
   * registered.
   */
  const componentsBlock = pluginSource.match(/components:\s*\{([\s\S]*?)\n {2}\},/)?.[1] ?? "";
  const registered = new Set(
    [...componentsBlock.matchAll(/^\s{4}(V[A-Za-z0-9]+),/gm)].map((match) => match[1]),
  );

  test("registers every Vuetify component used in the templates", () => {
    const missing = new Map<string, Set<string>>();

    for (const [file, source] of Object.entries(vueSources)) {
      for (const match of source.matchAll(/<v-([a-z0-9-]+)/g)) {
        const component = toComponentName(match[1]);
        if (registered.has(component)) {
          continue;
        }
        if (!missing.has(component)) {
          missing.set(component, new Set());
        }
        missing.get(component)!.add(file);
      }
    }

    const details = [...missing.entries()]
      .map(([component, files]) => `${component} (${[...files].join(", ")})`)
      .join(", ");

    // The plugin registers components explicitly, so a template that uses an
    // unregistered component silently renders as an unknown element instead
    // of failing loudly.
    expect(details).toBe("");
  });

  test("registers at least the components the templates rely on", () => {
    expect(registered.size).toBeGreaterThan(30);
    expect(registered.has("VAlert")).toBe(true);
    expect(registered.has("VCheckboxBtn")).toBe(true);
    expect(registered.has("VExpandTransition")).toBe(true);
  });
});
