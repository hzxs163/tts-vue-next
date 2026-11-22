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
let currentPreviewTaskId: string | null = null;

onMounted(() => {
  void voicesStore.ensureActiveCatalog();
});

onUnmounted(() => {
  stopPreview();
});

const isCurrentFavorite = computed(() => voicesStore.isFavorite(voicesStore.selectedVoice));

/** While the sample is being generated the button is already clickable: it cancels. */
const previewActive = computed(() => previewPlaying.value || previewLoading.value);

const favoriteCount = computed(() => voicesStore.favorites.length);

const selectedLocale = computed({
  get: () => voicesStore.selectedLocale,
  set: (value: string | null) => {
    if (value) {
      voicesStore.setLocale(value);
      stopPreview();
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
  if (currentPreviewTaskId) {
    void invoke("tts_stop", { taskId: currentPreviewTaskId }).catch(() => undefined);
    currentPreviewTaskId = null;
  }
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
  currentPreviewTaskId = taskId;

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

    if (currentPreviewTaskId !== taskId) {
      return;
    }
    currentPreviewTaskId = null;

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
    if (currentPreviewTaskId === taskId) {
      stopPreview();
    }
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
        variant="outlined"
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

      <div class="voice-selector__actions">
        <v-btn
          icon
          :size="36"
          variant="text"
          class="voice-selector__action voice-selector__favorite"
          :class="{ 'voice-selector__favorite--active': isCurrentFavorite }"
          :title="isCurrentFavorite ? $t('tts.options.unfavorite') : $t('tts.options.favorite')"
          :aria-label="
            isCurrentFavorite ? $t('tts.options.unfavorite') : $t('tts.options.favorite')
          "
          @click="toggleCurrentFavorite"
        >
          <!-- Inline SVGs keep the glyph geometry exact; icon fonts carry
               side bearings that push the play triangle off the circle centre. -->
          <svg
            v-if="isCurrentFavorite"
            class="voice-selector__glyph"
            width="19"
            height="19"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <polygon
              points="12,2.6 15.1,8.7 22,9.8 17,14.7 18.2,21.5 12,18.3 5.8,21.5 7,14.7 2,9.8 8.9,8.7"
              fill="currentColor"
            />
          </svg>
          <svg
            v-else
            class="voice-selector__glyph"
            width="19"
            height="19"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <polygon
              points="12,2.6 15.1,8.7 22,9.8 17,14.7 18.2,21.5 12,18.3 5.8,21.5 7,14.7 2,9.8 8.9,8.7"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linejoin="round"
            />
          </svg>
        </v-btn>

        <v-btn
          icon
          :size="36"
          :variant="previewPlaying ? 'tonal' : 'flat'"
          color="primary"
          class="voice-selector__action voice-selector__preview"
          :class="{ 'voice-selector__preview--playing': previewPlaying }"
          :loading="previewLoading"
          :title="previewActive ? $t('tts.options.stop') : $t('tts.options.previewVoice')"
          :aria-label="previewActive ? $t('tts.options.stop') : $t('tts.options.previewVoice')"
          @click="togglePreview"
        >
          <svg
            v-if="previewPlaying"
            class="voice-selector__glyph"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <rect x="7" y="7" width="10" height="10" rx="1" fill="currentColor" />
          </svg>
          <svg
            v-else
            class="voice-selector__glyph"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <polygon points="8,5 19,12 8,19" fill="currentColor" />
          </svg>
        </v-btn>
      </div>
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
 * The two controls share a subtle pill so they read as one toolbar instead of
 * two unrelated circles. 36px buttons + 4px padding keep the group at 46px,
 * close to the height of the comfortable autocomplete next to it.
 */
.voice-selector__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border: 1px solid rgba(var(--v-border-color), 0.12);
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.035);
}

.voice-selector__action {
  flex: 0 0 auto;
  transition:
    transform 0.16s ease,
    box-shadow 0.16s ease,
    background-color 0.16s ease,
    color 0.16s ease;
}

.voice-selector__glyph {
  display: block;
  flex: 0 0 auto;
  text-indent: 0;
}

/* The star is secondary: quiet at rest, warm only when it is actually used. */
.voice-selector__favorite {
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.voice-selector__favorite:hover {
  color: rgb(var(--v-theme-on-surface));
  background: rgba(var(--v-theme-on-surface), 0.08);
}

.voice-selector__favorite--active,
.voice-selector__favorite--active:hover {
  color: rgb(var(--v-theme-warning));
  background: rgba(var(--v-theme-warning), 0.16);
}

/* The play button is the primary action; stop drops the shadow to step back. */
.voice-selector__preview {
  box-shadow: 0 2px 6px rgba(var(--v-theme-primary), 0.28);
}

.voice-selector__preview:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 10px rgba(var(--v-theme-primary), 0.34);
}

.voice-selector__preview:active {
  transform: translateY(0);
  box-shadow: 0 1px 3px rgba(var(--v-theme-primary), 0.3);
}

.voice-selector__preview--playing,
.voice-selector__preview--playing:hover,
.voice-selector__preview--playing:active {
  transform: none;
  box-shadow: none;
}

.voice-selector__preview.v-btn--loading {
  pointer-events: auto;
  cursor: pointer;
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
