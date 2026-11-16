import { defineStore } from "pinia";
import { DEFAULT_DICTIONARY_RULES } from "../constants/dictionaryPresets";
import type { DictionaryRule } from "../types";

const PAUSE_TAG_REGEX = /(?:\[|【)(?:停顿|pause)[\s\S]*?(?:\]|】)|<\s*break\s+[^>]*\/?>/gi;

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface DictionaryState {
  enabled: boolean;
  rules: DictionaryRule[];
}

export const useDictionaryStore = defineStore("dictionary", {
  state: (): DictionaryState => ({
    enabled: true,
    rules: [...DEFAULT_DICTIONARY_RULES],
  }),

  actions: {
    setEnabled(enabled: boolean) {
      this.$patch({ enabled });
    },

    addRule(rule: Omit<DictionaryRule, "id">) {
      const newRule: DictionaryRule = {
        ...rule,
        id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      };
      this.$patch((state) => {
        state.rules.unshift(newRule);
      });
    },

    updateRule(id: string, updates: Partial<Omit<DictionaryRule, "id">>) {
      this.$patch((state) => {
        const index = state.rules.findIndex((r) => r.id === id);
        if (index !== -1) {
          state.rules[index] = { ...state.rules[index], ...updates };
        }
      });
    },

    deleteRule(id: string) {
      this.$patch((state) => {
        state.rules = state.rules.filter((r) => r.id !== id);
      });
    },

    toggleRule(id: string, forceEnabled?: boolean) {
      this.$patch((state) => {
        const rule = state.rules.find((r) => r.id === id);
        if (rule) {
          rule.enabled = forceEnabled !== undefined ? forceEnabled : !rule.enabled;
        }
      });
    },

    importRules(imported: DictionaryRule[], overwrite: boolean = false) {
      const validRules = imported.filter(
        (r) => typeof r.origin === "string" && typeof r.replacement === "string",
      );
      this.$patch((state) => {
        if (overwrite) {
          state.rules = validRules.map((r, i) => ({
            ...r,
            id: r.id || `imported-${Date.now()}-${i}`,
          }));
        } else {
          // Prepend new rules while avoiding duplicate origins
          const existingOrigins = new Set(state.rules.map((r) => r.origin));
          const newRules = validRules
            .filter((r) => !existingOrigins.has(r.origin))
            .map((r, i) => ({
              ...r,
              id: r.id || `imported-${Date.now()}-${i}`,
            }));
          state.rules = [...newRules, ...state.rules];
        }
      });
    },

    exportRules(): string {
      return JSON.stringify(this.rules, null, 2);
    },

    resetToDefaults() {
      this.$patch({
        rules: [...DEFAULT_DICTIONARY_RULES],
      });
    },

    applyDictionary(text: string): string {
      if (!this.enabled || !text) {
        return text;
      }

      // Step 1: Protect pause and break tags so rules do not corrupt them
      const placeholders: string[] = [];
      const protectedText = text.replace(PAUSE_TAG_REGEX, (match) => {
        const placeholder = `@@__PAUSE_TAG_${placeholders.length}__@@`;
        placeholders.push(match);
        return placeholder;
      });

      // Step 2: Separate active non-regex rules and regex rules
      const activeRules = this.rules.filter((r) => r.enabled && r.origin);
      const regularRules = activeRules.filter((r) => !r.isRegex);
      const regexRules = activeRules.filter((r) => r.isRegex);

      // Longest match first prevents substrings from breaking compound words
      regularRules.sort((a, b) => b.origin.length - a.origin.length);

      let result = protectedText;

      // Step 3: Apply plain text replacements
      for (const rule of regularRules) {
        const pattern = escapeRegExp(rule.origin);
        const flags = rule.matchCase ? "g" : "gi";
        try {
          const re = new RegExp(pattern, flags);
          result = result.replace(re, rule.replacement);
        } catch {
          // Ignore invalid regex patterns
        }
      }

      // Step 4: Apply regex replacements
      for (const rule of regexRules) {
        try {
          const flags = rule.matchCase ? "g" : "gi";
          const re = new RegExp(rule.origin, flags);
          result = result.replace(re, rule.replacement);
        } catch {
          // Silently ignore broken user regex
        }
      }

      // Step 5: Restore protected pause tags
      if (placeholders.length > 0) {
        result = result.replace(/@@__PAUSE_TAG_(\d+)__@@/g, (_, indexStr) => {
          const index = Number.parseInt(indexStr, 10);
          return placeholders[index] ?? "";
        });
      }

      return result;
    },
  },

  persist: true,
});
