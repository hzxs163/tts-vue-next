<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "vue-i18n";
import { OPENAI_LOCALE, useVoicesStore } from "../../stores/voices";
import { useSettingsStore } from "../../stores/settings";
import type { TtsProviderId } from "../../types";
import { voiceGenderKey, voiceLabel } from "../../utils/voiceLabels";

const voicesStore = useVoicesStore();
const settingsStore = useSettingsStore();
const { t } = useI18n();
const showFavoritesOnly = ref(false);
const previewLoading = ref(false);
const previewPlaying = ref(false);
let previewAudio: HTMLAudioElement | null = null;
let previewUrl: string | null = null;

onMounted(() => {
  void voicesStore.ensureActiveCatalog();
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
  if (settingsStore.openaiKey.trim() && settingsStore.openaiBaseUrl.trim()) {
    items.push({ title: t("common.providerOpenai"), value: "openai" });
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
  voicesStore.locales.map((locale) => ({
    // The OpenAI catalog has no locales; it uses a placeholder group.
    title: locale === OPENAI_LOCALE ? t("common.customLocale") : locale,
    value: locale,
  })),
);

/**
 * Rows of the voice picker.
 *
 * `title` is the cleaned display name and `code` the voice id without its
 * locale prefix, so the menu can show both on separate lines while the closed
 * field stays on one short line. `filterKeys` lets the search match either.
 */
const voiceItems = computed<VoiceRow[]>(() => {
  let list = voicesStore.filteredVoices;
  if (showFavoritesOnly.value) {
    list = list.filter((voice) => voicesStore.isFavorite(voice.ShortName));
  }

  return list.map((voice) => ({
    title: voiceLabel(voice),
    // The menu shows the untouched id so nothing is hidden from the user.
    code: voice.ShortName,
    gender: voiceGenderKey(voice),
    value: voice.ShortName,
  }));
});

interface VoiceRow {
  title: string;
  code: string;
  gender: "female" | "male" | null;
  value: string;
}

/** The row matching the current selection, for the closed field. */
const selectedVoiceItem = computed<VoiceRow | null>(
  () => voiceItems.value.find((item) => item.value === voicesStore.selectedVoice) ?? null,
);

/** Full id, used as the native tooltip of the closed field. */
const selectedVoiceTitle = computed(
  () =>
    voicesStore.currentVoice?.ShortName ??
    selectedVoiceItem.value?.value ??
    voicesStore.selectedVoice,
);

function genderLabel(gender: "female" | "male" | null): string {
  if (gender === "female") {
    return t("tts.options.genderFemale");
  }
  if (gender === "male") {
    return t("tts.options.genderMale");
  }
  return "";
}

/** Toggles a favourite from inside the menu without selecting the row. */
function toggleFavoriteRow(value: string) {
  voicesStore.toggleFavorite(value);
}

function isRowFavorite(value: string): boolean {
  return voicesStore.isFavorite(value);
}

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
          @click="showFavoritesOnly = true"
        >
          {{ $t("tts.options.favoriteCount", { count: favoriteCount }) }}
        </v-btn>
      </div>
    </div>

    <div class="voice-selector__row">
      <v-autocomplete
        v-model="selectedVoice"
        :items="voiceItems"
        item-title="title"
        item-value="value"
        :loading="voicesStore.loading"
        :filter-keys="['title', 'code', 'value']"
        :title="selectedVoiceTitle"
        :menu-props="{ maxHeight: 380 }"
        :no-data-text="$t('tts.options.noVoiceMatch')"
        density="comfortable"
        class="voice-selector__field"
        hide-details
      >
        <template #item="{ props: itemProps, item }">
          <v-list-item v-bind="itemProps" class="voice-selector__option">
            <template #prepend>
              <v-icon size="18" class="voice-selector__option-icon">
                {{ item.raw.gender === "male" ? "mdi-account-voice" : "mdi-account-voice" }}
              </v-icon>
            </template>

            <template #title>
              <div class="voice-selector__option-title">
                <span class="voice-selector__option-name">{{ item.raw.title }}</span>
                <span v-if="item.raw.gender" class="voice-selector__badge">
                  {{ genderLabel(item.raw.gender) }}
                </span>
              </div>
            </template>

            <template #subtitle>
              <span class="voice-selector__option-code">{{ item.raw.code }}</span>
            </template>

            <template #append>
              <v-btn
                :icon="isRowFavorite(item.raw.value) ? 'mdi-star' : 'mdi-star-outline'"
                size="small"
                variant="text"
                :color="isRowFavorite(item.raw.value) ? 'amber-darken-2' : undefined"
                @click.stop="toggleFavoriteRow(item.raw.value)"
              />
            </template>
          </v-list-item>
        </template>
      </v-autocomplete>

      <v-btn
        icon
        size="default"
        variant="tonal"
        class="voice-selector__action"
        :color="isCurrentFavorite ? 'amber-darken-2' : undefined"
        :title="isCurrentFavorite ? $t('tts.options.unfavorite') : $t('tts.options.favorite')"
        @click="toggleCurrentFavorite"
      >
        <v-icon size="20">{{ isCurrentFavorite ? "mdi-star" : "mdi-star-outline" }}</v-icon>
      </v-btn>

      <v-btn
        icon
        size="default"
        variant="tonal"
        color="primary"
        class="voice-selector__action"
        :loading="previewLoading"
        :title="previewPlaying ? $t('tts.options.stop') : $t('tts.options.previewVoice')"
        @click="togglePreview"
      >
        <v-icon size="20">{{ previewPlaying ? "mdi-stop" : "mdi-play" }}</v-icon>
      </v-btn>
    </div>

    <p v-if="voicesStore.usingCache" class="voice-selector__cache-hint">
      {{ $t("errors.voiceCache") }}
    </p>
  </div>
</template>

<style scoped>
.voice-selector__row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.voice-selector__field {
  flex: 1 1 auto;
  min-width: 0;
}

.voice-selector__selected {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * 40px buttons line up with the height of a comfortable field. The icon needs
 * an explicit line-height: the glyph otherwise inherits the button's line box
 * and sits above the optical centre.
 */
.voice-selector__action {
  flex: 0 0 auto;
}

.voice-selector__action :deep(.v-icon) {
  line-height: 1;
}

.voice-selector__option {
  padding-top: 6px;
  padding-bottom: 6px;
}

.voice-selector__option-icon {
  opacity: 0.6;
  margin-right: 12px;
}

.voice-selector__option-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.voice-selector__option-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.voice-selector__badge {
  flex: none;
  padding: 0 5px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 16px;
  background: rgba(var(--v-border-color), 0.12);
  color: rgb(var(--v-theme-on-surface));
  opacity: 0.75;
}

.voice-selector__option-code {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  opacity: 0.7;
}

.voice-selector__cache-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: rgb(var(--v-theme-warning));
}
</style>
