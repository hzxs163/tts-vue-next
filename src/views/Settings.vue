<script setup lang="ts">
import { computed, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "vue-i18n";
import { useMessage } from "vuetify-message-vue3";
import type { ConflictStrategy, FileNamePattern } from "../types";
import { useSettingsStore } from "../stores/settings";
import { useVoicesStore } from "../stores/voices";
import BgmConfigCard from "../components/common/BgmConfigCard.vue";

const settingsStore = useSettingsStore();
const voicesStore = useVoicesStore();
const message = useMessage();
const { t } = useI18n();

/** The key is masked by default; revealing it is an explicit action. */
const showAzureKey = ref(false);
const showOpenAiKey = ref(false);

const azureConfigured = computed(
  () => Boolean(settingsStore.azureKey) && Boolean(settingsStore.azureRegion),
);

async function verifyAzure() {
  const ok = await voicesStore.fetchAzureVoices({
    key: settingsStore.azureKey,
    region: settingsStore.azureRegion,
  });

  if (ok) {
    message.success(t("settings.azure.verified", { count: voicesStore.azureVoices.length }));
    return;
  }

  message.error(t("settings.azure.verifyFailed", { message: voicesStore.azureError ?? "" }));
}

const formatOptions = computed(() => [
  { title: t("common.formats.mp3"), value: "mp3" },
  { title: t("common.formats.wav"), value: "wav" },
  { title: t("common.formats.ogg"), value: "ogg" },
  { title: t("common.formats.flac"), value: "flac" },
]);

const fileNamePatternOptions = computed((): Array<{ title: string; value: FileNamePattern }> => [
  { title: t("settings.fileNamePatterns.content"), value: "content" },
  { title: t("settings.fileNamePatterns.timestamp"), value: "timestamp" },
  { title: t("settings.fileNamePatterns.content_timestamp"), value: "content_timestamp" },
  { title: t("settings.fileNamePatterns.default"), value: "default" },
]);

const languageOptions = computed(() => [
  { title: t("settings.languages.zh"), value: "zh-CN" },
  { title: t("settings.languages.en"), value: "en-US" },
]);

const conflictOptions = computed((): Array<{ title: string; value: ConflictStrategy }> => [
  { title: t("settings.conflictStrategies.rename"), value: "rename" },
  { title: t("settings.conflictStrategies.skip"), value: "skip" },
  { title: t("settings.conflictStrategies.overwrite"), value: "overwrite" },
]);

const retryOptions = Array.from({ length: 10 }, (_, index) => ({
  title: String(index + 1),
  value: index + 1,
}));

const concurrencyOptions = [1, 2, 3, 4, 5].map((value) => ({
  title: String(value),
  value,
}));

async function selectSavePath() {
  try {
    const path = await invoke<string | null>("select_folder");
    if (path) {
      settingsStore.updateSavePath(path);
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  }
}
</script>

<template>
  <v-container fluid class="settings-page">
    <section class="settings-workspace">
      <v-card flat class="settings-panel glass-panel">
        <v-card-item>
          <template #prepend>
            <v-avatar color="primary" variant="tonal" size="36">
              <v-icon>mdi-cog-outline</v-icon>
            </v-avatar>
          </template>
          <v-card-title class="text-h6">{{ $t("nav.settings") }}</v-card-title>
        </v-card-item>

        <v-card-text class="settings-panel__body">
          <div class="settings-panel__content">
            <div class="settings-column settings-column--main">
              <section class="settings-group">
                <div class="settings-group__header">
                  <v-icon size="18" color="primary">mdi-folder-cog-outline</v-icon>
                  <span class="text-subtitle-1 font-weight-medium">{{
                    $t("settings.sections.output")
                  }}</span>
                </div>

                <div class="settings-fields">
                  <div class="settings-field settings-field--full">
                    <v-text-field
                      :model-value="settingsStore.savePath"
                      :label="$t('settings.fields.savePath')"
                      :placeholder="$t('settings.fields.savePathPlaceholder')"
                      density="comfortable"
                      readonly
                      append-inner-icon="mdi-folder-outline"
                      @click="selectSavePath"
                    />
                  </div>

                  <v-select
                    :model-value="settingsStore.outputFormat"
                    :items="formatOptions"
                    density="comfortable"
                    :label="$t('settings.fields.defaultFormat')"
                    @update:model-value="settingsStore.updateOutputFormat"
                  />

                  <v-select
                    :model-value="settingsStore.fileNamePattern"
                    :items="fileNamePatternOptions"
                    density="comfortable"
                    :label="$t('settings.fields.fileNamePattern')"
                    @update:model-value="settingsStore.updateFileNamePattern"
                  />

                  <v-select
                    :model-value="settingsStore.language"
                    :items="languageOptions"
                    density="comfortable"
                    :label="$t('settings.fields.displayLanguage')"
                    @update:model-value="settingsStore.updateLanguage"
                  />

                  <v-select
                    :model-value="settingsStore.conflictStrategy"
                    :items="conflictOptions"
                    density="comfortable"
                    :label="$t('settings.fields.conflictStrategy')"
                    @update:model-value="settingsStore.updateConflictStrategy"
                  />
                </div>

                <div class="settings-toggles">
                  <v-switch
                    :model-value="settingsStore.autoplay"
                    :label="$t('settings.fields.autoplay')"
                    density="comfortable"
                    color="primary"
                    hide-details
                    @update:model-value="(value) => settingsStore.updateAutoplay(Boolean(value))"
                  />

                  <v-switch
                    :model-value="settingsStore.exportSubtitles"
                    :label="$t('settings.fields.exportSubtitles')"
                    density="comfortable"
                    color="primary"
                    hide-details
                    @update:model-value="
                      (value) => settingsStore.updateExportSubtitles(Boolean(value))
                    "
                  />
                </div>
              </section>

              <section class="settings-group">
                <div class="settings-group__header">
                  <v-icon size="18" color="primary">mdi-tune-variant</v-icon>
                  <span class="text-subtitle-1 font-weight-medium">{{
                    $t("settings.sections.processing")
                  }}</span>
                </div>

                <div class="settings-fields settings-fields--adaptive">
                  <v-select
                    :model-value="settingsStore.maxRetries"
                    :items="retryOptions"
                    density="comfortable"
                    :label="$t('settings.fields.maxRetries')"
                    @update:model-value="settingsStore.updateMaxRetries"
                  />

                  <v-select
                    :model-value="settingsStore.fileConcurrency"
                    :items="concurrencyOptions"
                    density="comfortable"
                    :label="$t('settings.fields.fileConcurrency')"
                    @update:model-value="settingsStore.updateFileConcurrency"
                  />

                  <v-select
                    :model-value="settingsStore.chunkConcurrency"
                    :items="concurrencyOptions"
                    density="comfortable"
                    :label="$t('settings.fields.chunkConcurrency')"
                    @update:model-value="settingsStore.updateChunkConcurrency"
                  />
                </div>
              </section>

              <section class="settings-group">
                <div class="settings-group__header">
                  <v-icon size="18" color="primary">mdi-cloud-outline</v-icon>
                  <span class="text-subtitle-1 font-weight-medium">{{
                    $t("settings.sections.azure")
                  }}</span>
                </div>

                <div class="settings-toggles">
                  <v-switch
                    :model-value="settingsStore.azureEnabled"
                    :label="$t('settings.azure.enabled')"
                    density="comfortable"
                    color="primary"
                    hide-details
                    @update:model-value="
                      (value) => settingsStore.updateAzureEnabled(Boolean(value))
                    "
                  />
                </div>

                <div class="settings-fields">
                  <v-text-field
                    :model-value="settingsStore.azureRegion"
                    :label="$t('settings.azure.region')"
                    :placeholder="$t('settings.azure.regionPlaceholder')"
                    density="comfortable"
                    hide-details
                    @update:model-value="settingsStore.updateAzureRegion"
                  />

                  <v-text-field
                    :model-value="settingsStore.azureKey"
                    :label="$t('settings.azure.key')"
                    :type="showAzureKey ? 'text' : 'password'"
                    :append-inner-icon="showAzureKey ? 'mdi-eye-off' : 'mdi-eye'"
                    density="comfortable"
                    hide-details
                    autocomplete="off"
                    @update:model-value="settingsStore.updateAzureKey"
                    @click:append-inner="showAzureKey = !showAzureKey"
                  />
                </div>

                <div class="d-flex flex-wrap align-center ga-2">
                  <v-btn
                    variant="outlined"
                    size="small"
                    prepend-icon="mdi-cloud-check-outline"
                    :loading="voicesStore.azureLoading"
                    :disabled="!azureConfigured"
                    @click="verifyAzure"
                  >
                    {{ $t("settings.azure.verify") }}
                  </v-btn>
                  <span v-if="voicesStore.azureVoices.length > 0" class="text-caption text-success">
                    {{
                      $t("settings.azure.voiceCount", {
                        count: voicesStore.azureVoices.length,
                      })
                    }}
                  </span>
                </div>

                <div class="text-caption text-medium-emphasis">
                  {{ $t("settings.azure.storageHint") }}
                </div>
              </section>

              <section class="settings-group">
                <div class="settings-group__header">
                  <v-icon size="18" color="primary">mdi-robot-outline</v-icon>
                  <span class="text-subtitle-1 font-weight-medium">{{
                    $t("settings.sections.openai")
                  }}</span>
                </div>

                <div class="settings-fields">
                  <v-text-field
                    :model-value="settingsStore.openaiBaseUrl"
                    :label="$t('settings.openai.baseUrl')"
                    :placeholder="$t('settings.openai.baseUrlPlaceholder')"
                    density="comfortable"
                    hide-details
                    @update:model-value="settingsStore.updateOpenAiBaseUrl"
                  />

                  <v-text-field
                    :model-value="settingsStore.openaiKey"
                    :label="$t('settings.openai.key')"
                    :type="showOpenAiKey ? 'text' : 'password'"
                    :append-inner-icon="showOpenAiKey ? 'mdi-eye-off' : 'mdi-eye'"
                    density="comfortable"
                    hide-details
                    autocomplete="off"
                    @update:model-value="settingsStore.updateOpenAiKey"
                    @click:append-inner="showOpenAiKey = !showOpenAiKey"
                  />

                  <v-text-field
                    :model-value="settingsStore.openaiModel"
                    :label="$t('settings.openai.model')"
                    :placeholder="$t('settings.openai.modelPlaceholder')"
                    density="comfortable"
                    hide-details
                    @update:model-value="settingsStore.updateOpenAiModel"
                  />

                  <v-text-field
                    class="settings-field--wide"
                    :model-value="settingsStore.openaiVoices"
                    :label="$t('settings.openai.voices')"
                    :placeholder="$t('settings.openai.voicesPlaceholder')"
                    :hint="$t('settings.openai.voicesHint')"
                    persistent-hint
                    density="comfortable"
                    @update:model-value="settingsStore.updateOpenAiVoices"
                  />
                </div>

                <div class="text-caption text-medium-emphasis">
                  {{ $t("settings.openai.storageHint") }}
                </div>
              </section>
            </div>

            <div class="settings-column settings-column--side">
              <section class="settings-group settings-group--bgm">
                <BgmConfigCard :elevation="0" />
              </section>
            </div>
          </div>
        </v-card-text>
      </v-card>
    </section>
  </v-container>
</template>

<style scoped>
.settings-page {
  padding: 10px;
  height: 100%;
  min-height: 0;
  max-height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(circle at top right, rgba(var(--v-theme-primary), 0.08), transparent 22%),
    linear-gradient(180deg, rgba(var(--v-theme-surface), 1), rgba(var(--v-theme-surface), 0.98));
}

.settings-workspace {
  flex: 1 1 0;
  min-height: 0;
  height: 100%;
  max-height: 100%;
  display: flex;
  flex-direction: column;
}

.settings-panel {
  flex: 1 1 0;
  min-height: 0;
  height: 100%;
  max-height: 100%;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background:
    radial-gradient(circle at top right, rgba(var(--v-theme-primary), 0.1), transparent 30%),
    rgba(var(--v-theme-surface), 0.78);
  backdrop-filter: blur(18px);
  box-shadow: 0 18px 60px rgba(var(--v-theme-on-surface), 0.08);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.settings-panel__body {
  flex: 1 1 0;
  display: flex;
  min-height: 0;
  /* Content that does not fit has to scroll, never get clipped. */
  overflow-y: auto;
  overflow-x: hidden;
  padding-top: 5px;
}

.settings-panel__content {
  flex: 1;
  display: grid;
  /*
   * The side column holds the BGM card, which needs a fixed minimum width
   * for its four strength buttons; the main column takes the rest. Using
   * grid instead of flex keeps both columns from collapsing into each
   * other when the window gets narrow.
   */
  grid-template-columns: minmax(0, 1.2fr) minmax(320px, 1fr);
  gap: 12px;
  align-items: start;
  min-width: 0;
}

.settings-column {
  display: grid;
  gap: 12px;
  /* Cards keep their natural height instead of stretching into empty
     columns that leave a large void at the bottom of the page. */
  align-content: start;
  min-width: 0;
}

.settings-group {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 20px;
  background: rgba(var(--v-theme-surface), 0.6);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.settings-group--bgm {
  padding: 12px;
}

.settings-group__header {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.settings-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 12px;
}

/* A field carrying a long value and a hint reads better across both columns. */
.settings-field--wide {
  grid-column: 1 / -1;
}

/*
 * The processing group holds three numeric selects. `auto-fit` keeps them on
 * a single row while there is room and folds them over before a label ever
 * gets truncated.
 */
.settings-fields--adaptive {
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
}

.settings-field--full {
  grid-column: 1 / -1;
}

.settings-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 24px;
}

.settings-toggles :deep(.v-switch) {
  flex: 0 1 auto;
  min-width: 0;
}

.settings-toggles :deep(.v-label) {
  white-space: normal;
  overflow: visible;
}

@media (max-width: 900px) {
  .settings-panel__content {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 720px) {
  .settings-fields,
  .settings-fields--adaptive {
    grid-template-columns: minmax(0, 1fr);
  }

  .settings-field--full {
    grid-column: auto;
  }

  .settings-toggles {
    flex-direction: column;
    gap: 4px;
  }
}
</style>
