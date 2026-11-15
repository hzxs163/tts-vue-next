import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
    // Unit tests deliberately mount Vuetify components as stubs / unresolved
    // custom elements, so Vue's resolution warnings are pure noise here.
    onConsoleLog(log, type) {
      if (type === "stderr" && log.includes("Failed to resolve component")) {
        return false;
      }
      return undefined;
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,vue}"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.d.ts",
        "src/locales/**",
        "src/types/**",
      ],
    },
  },
});
