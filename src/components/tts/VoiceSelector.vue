<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "vue-i18n";
import { useVoicesStore } from "../../stores/voices";
import { useSettingsStore } from "../../stores/settings";
import type { TtsProviderId } from "../../types";

const voicesStore = useVoicesStore();
const settingsStore = useSettingsStore();
const { t } = useI18n();
const showFavoritesOnly = ref(false);
const previewLoading = ref(false);
const previewPlaying = ref(false);
let previewAudio: HTMLAudioElement | null = null;
let previewUrl: string | null = null;

onMounted(() => {
  void voicesStore.fetchVoices();
});

onUnmounted(() => {
  stopPreview();
});

const isCurrentFavorite = computed(() => voicesStore.isFavorite(voicesStore.selectedVoice));

const favoriteCount = computed(() => voicesStore.favorites.length);

const selectedLocale = computed({
  get: () => voicesStore.selectedLocale,
  set: (value: string | null) => {
    if (value) {
      voicesStore.setLocale(value);
    }
  },
});

const selectedVoice = computed({
  get: () => voicesStore.selectedVoice,
  set: (value: string | null) => {
    if (value) {
      voicesStore.setVoice(value);
      stopPreview();
    }
  },
});

/**
 * Azure is only offered once it is fully configured, so the switch cannot lead
 * to an unusable state.
 */
const providerItems = computed(() => {
  const items: Array<{ title: string; value: TtsProviderId }> = [
    { title: t("common.providerEdge"), value: "edge" },
  ];
  if (settingsStore.azureEnabled && settingsStore.azureKey && settingsStore.azureRegion) {
    items.push({ title: t("common.providerAzure"), value: "azure" });
  }
  return items;
});

const selectedProvider = computed({
  get: () => voicesStore.selectedProvider,
  set: (value: TtsProviderId) => {
    stopPreview();
    void voicesStore.setProvider(value);
  },
});

const localeItems = computed(() =>
  voicesStore.locales.map((locale) => ({ title: locale, value: locale })),
);

const voiceItems = computed(() => {
  let list = voicesStore.filteredVoices;
  if (showFavoritesOnly.value) {
    list = list.filter((voice) => voicesStore.isFavorite(voice.ShortName));
  }

  return list.map((voice) => {
    const isFav = voicesStore.isFavorite(voice.ShortName);
    return {
      title: `${isFav ? "⭐ " : ""}${voice.FriendlyName || voice.ShortName} (${voice.Gender})`,
      value: voice.ShortName,
    };
  });
});

function toggleCurrentFavorite() {
  voicesStore.toggleFavorite(voicesStore.selectedVoice);
}

function getSampleText(voiceName: string, locale: string): string {
  const shortVoice = voiceName.split("-").pop()?.replace("Neural", "") || voiceName;
  if (locale.startsWith("zh-HK")) {
    return `你好，我係${shortVoice}，好開心為你提供語音服務。`;
  }
  if (locale.startsWith("zh-TW")) {
    return `你好，我是${shortVoice}，很高興為你提供語音服務。`;
  }
  if (locale.startsWith("zh")) {
    return `你好，我是${shortVoice}，很高兴为你提供语音服务。`;
  }
  if (locale.startsWith("ja")) {
    return `こんにちは、${shortVoice}です。よろしくお願いいたします。`;
  }
  if (locale.startsWith("en")) {
    return `Hello, I am ${shortVoice}, nice to meet you.`;
  }
  return `Hello, this is a voice sample for ${shortVoice}.`;
}

function stopPreview() {
  if (previewAudio) {
    previewAudio.pause();
    previewAudio.currentTime = 0;
    previewAudio = null;
  }
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
  previewLoading.value = false;
  previewPlaying.value = false;
}

async function togglePreview() {
  if (previewPlaying.value || previewLoading.value) {
    stopPreview();
    return;
  }

  const voice = voicesStore.selectedVoice;
  const locale = voicesStore.selectedLocale;
  const text = getSampleText(voice, locale);
  const taskId = `preview-${crypto.randomUUID()}`;

  previewLoading.value = true;
  try {
    const buffer = await invoke<ArrayBuffer>("tts_convert", {
      params: {
        text,
        voice,
        rate: "+0%",
        pitch: "+0Hz",
        volume: "+0%",
        format: "audio-24khz-48kbitrate-mono-mp3",
        task_id: taskId,
        max_retries: 1,
        chunk_concurrency: 1,
        ...voicesStore.requestProvider,
      },
    });

    const blob = new Blob([new Uint8Array(buffer)], { type: "audio/mpeg" });
    previewUrl = URL.createObjectURL(blob);
    previewAudio = new Audio(previewUrl);

    previewAudio.onended = () => {
      stopPreview();
    };
    previewAudio.onerror = () => {
      stopPreview();
    };

    await previewAudio.play();
    previewLoading.value = false;
    previewPlaying.value = true;
  } catch {
    stopPreview();
  }
}
</script>

<template>
  <div class="voice-selector">
    <v-select
      v-if="providerItems.length > 1"
      v-model="selectedProvider"
      :items="providerItems"
      :label="$t('common.provider')"
      prepend-inner-icon="mdi-cloud-outline"
      class="mb-3"
      density="comfortable"
      :loading="voicesStore.azureLoading"
    />

    <v-select
      v-model="selectedLocale"
      :items="localeItems"
      :label="$t('tts.options.language')"
      :loading="voicesStore.loading"
      prepend-inner-icon="mdi-translate"
      class="mb-3"
      density="comfortable"
    />

    <div class="d-flex align-center justify-space-between mb-2">
      <span class="text-body-2">{{ $t("tts.options.voice") }}</span>
      <div class="d-flex align-center ga-1">
        <v-btn
          size="x-small"
          :variant="!showFavoritesOnly ? 'tonal' : 'text'"
          :color="!showFavoritesOnly ? 'primary' : undefined"
          @click="showFavoritesOnly = false"
        >
          {{ $t("tts.options.allVoices") }}
        </v-btn>
        <v-btn
          size="x-small"
          :variant="showFavoritesOnly ? 'tonal' : 'text'"
          :color="showFavoritesOnly ? 'amber-darken-2' : undefined"
          prepend-icon="mdi-star"
          @click="showFavoritesOnly = true"
        >
          {{ favoriteCount }}
        </v-btn>
      </div>
    </div>

    <div class="d-flex align-center ga-2">
      <v-select
        v-model="selectedVoice"
        :items="voiceItems"
        :loading="voicesStore.loading"
        prepend-inner-icon="mdi-account-voice"
        density="comfortable"
        class="flex-grow-1"
        hide-details
      />

      <v-btn
        icon
        size="small"
        variant="tonal"
        :color="isCurrentFavorite ? 'amber-darken-2' : undefined"
        :title="isCurrentFavorite ? $t('tts.options.unfavorite') : $t('tts.options.favorite')"
        @click="toggleCurrentFavorite"
      >
        <v-icon>{{ isCurrentFavorite ? "mdi-star" : "mdi-star-outline" }}</v-icon>
      </v-btn>

      <v-btn
        icon
        size="small"
        variant="tonal"
        color="primary"
        :loading="previewLoading"
        :title="previewPlaying ? $t('tts.options.stop') : $t('tts.options.previewVoice')"
        @click="togglePreview"
      >
        <v-icon>{{ previewPlaying ? "mdi-stop" : "mdi-play" }}</v-icon>
      </v-btn>
    </div>

    <p v-if="voicesStore.usingCache" class="voice-selector__cache-hint">
      {{ $t("errors.voiceCache") }}
    </p>
  </div>
</template>

<style scoped>
.voice-selector__cache-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: rgb(var(--v-theme-warning));
}
</style>
