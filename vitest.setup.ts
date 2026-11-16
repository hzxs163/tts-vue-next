import i18n from "./src/plugins/i18n";

/**
 * Local test environment normalization.
 *
 * Some Node versions define a global `localStorage` that is unavailable unless
 * `--localstorage-file` is passed, which makes `window.localStorage` undefined
 * under happy-dom. Provide an in-memory fallback so store tests can exercise
 * the real persistence code paths.
 */
function ensureLocalStorage(): void {
  if (typeof window === "undefined" || window.localStorage) {
    return;
  }

  const values = new Map<string, string>();

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length(): number {
        return values.size;
      },
      clear(): void {
        values.clear();
      },
      getItem(key: string): string | null {
        return values.get(key) ?? null;
      },
      key(index: number): string | null {
        return Array.from(values.keys())[index] ?? null;
      },
      removeItem(key: string): void {
        values.delete(key);
      },
      setItem(key: string, value: string): void {
        values.set(key, String(value));
      },
    } satisfies Storage,
  });
}

ensureLocalStorage();

// Tests assert English copy; never depend on the host OS language.
i18n.global.locale.value = "en";
