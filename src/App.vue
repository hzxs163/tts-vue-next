<script setup lang="ts">
import { onMounted, onUnmounted, watch } from "vue";
import { useTheme } from "vuetify";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import TitleBar from "./components/layout/TitleBar.vue";
import AppLayout from "./components/layout/AppLayout.vue";
import GlobalAlerts from "./components/layout/GlobalAlerts.vue";
import i18n from "./plugins/i18n";
import { useSettingsStore } from "./stores/settings";
import { useTtsStore } from "./stores/tts";
import { useBatchStore } from "./stores/batch";
import type { TtsProgressEvent } from "./types";
import { normalizeAppLanguage, normalizeAppLocale } from "./utils/appLocale";
import { resolveThemeName } from "./utils/themeMode";
import { MessageProvider } from "vuetify-message-vue3";

const theme = useTheme();
const settingsStore = useSettingsStore();
const ttsStore = useTtsStore();
const batchStore = useBatchStore();
let media: MediaQueryList | null = null;
let unlistenProgress: UnlistenFn | null = null;

function applyTheme() {
  theme.change(resolveThemeName(settingsStore.themeMode, media?.matches ?? false));
}

function applyLanguage() {
  const language = normalizeAppLanguage(settingsStore.language);
  const locale = normalizeAppLocale(language);

  if (settingsStore.language !== language) {
    settingsStore.updateLanguage(language);
    return;
  }

  i18n.global.locale.value = locale;

  try {
    window.localStorage.setItem("app_language", language);
  } catch {
    return;
  }
}

onMounted(() => {
  media = window.matchMedia("(prefers-color-scheme: dark)");
  applyTheme();
  media.addEventListener("change", applyTheme);

  void listen<TtsProgressEvent>("tts://progress", (event) => {
    ttsStore.applyProgress(event.payload);
    batchStore.applyProgress(event.payload);
  }).then((fn) => {
    unlistenProgress = fn;
  });
});

onUnmounted(() => {
  media?.removeEventListener("change", applyTheme);
  media = null;
  unlistenProgress?.();
});

watch(() => settingsStore.themeMode, applyTheme);
watch(() => settingsStore.language, applyLanguage, { immediate: true });
</script>

<template>
  <v-app>
    <MessageProvider>
      <GlobalAlerts />
      <TitleBar />
      <AppLayout />
    </MessageProvider>
  </v-app>
</template>

<style>
html,
body {
  margin: 0;
  padding: 0;
  overflow: hidden;
  height: 100%;
}

#app {
  height: 100%;
}

.v-application {
  height: 100%;
  max-height: 100vh;
  overflow: hidden;
}

.v-application__wrap {
  min-height: 100% !important;
  max-height: 100vh;
  overflow: hidden;
}
</style>
