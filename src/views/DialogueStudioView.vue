<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "vue-i18n";
import { useMessage } from "vuetify-message-vue3";
import type { DialogueRole, TtsProviderId } from "../types";
import { DEFAULT_CAST_PRESETS } from "../constants/dialoguePresets";
import { useDialogueStore } from "../stores/dialogue";
import { useVoicesStore } from "../stores/voices";
import { useSettingsStore } from "../stores/settings";
import { useBgmStore } from "../stores/bgm";
import { saveAudioBytes } from "../utils/saveAudio";
import { formatScript } from "../utils/dialogueParser";
import BgmConfigCard from "../components/common/BgmConfigCard.vue";

const dialogueStore = useDialogueStore();
const voicesStore = useVoicesStore();
const settingsStore = useSettingsStore();
const bgmStore = useBgmStore();
const message = useMessage();
const { t } = useI18n();

// Active Tab: "script" | "cast" | "bgm"
const activeTab = ref<"script" | "cast" | "bgm">("script");

// Script import dialog
const showImportDialog = ref(false);
const importText = ref("");
const importMode = ref<"prefix" | "quotes">("prefix");

// Role editor dialog
const showRoleDialog = ref(false);
const isEditingRole = ref(false);
const editingRoleId = ref("");
const roleFormName = ref("");
const roleFormVoice = ref("");
const roleFormLocale = ref("");
const roleFormProvider = ref<TtsProviderId>("edge");
const roleFormRate = ref(0);
const roleFormPitch = ref(0);
const roleFormVolume = ref(0);
const roleFormColor = ref("primary");
const roleFormIsDefault = ref(false);

const pauseOptions = [100, 200, 300, 500, 800, 1000, 1500, 2000];

const colorOptions = [
  "primary",
  "info",
  "warning",
  "success",
  "purple",
  "pink",
  "teal",
  "amber",
  "deep-orange",
  "cyan",
];

/**
 * The colour select used to show the raw theme token ("purple"), which leaked
 * an implementation detail into the UI.
 */
const colorSelectItems = computed(() =>
  colorOptions.map((color) => ({
    title: t(`dialogue.cast.colors.${color}`),
    value: color,
  })),
);

const presetOptions = computed(() =>
  DEFAULT_CAST_PRESETS.map((p) => ({
    title: p.name,
    subtitle: p.description,
    value: p.id,
  })),
);

/**
 * Locales that a radio drama is most likely to need, listed before the rest
 * so the picker does not open on a hundred alphabetically sorted entries.
 */
const PREFERRED_LOCALES = ["zh-CN", "zh-TW", "zh-HK", "en-US", "en-GB", "ja-JP", "ko-KR"];

/**
 * Voice catalogs of the two providers, grouped by locale.
 *
 * The cast picker reads from whichever provider the role is assigned to, so
 * characters may speak through different services in the same drama.
 */
const activeVoiceGroups = computed(() =>
  roleFormProvider.value === "azure" ? voicesStore.azureVoicesByLocale : voicesStore.voicesByLocale,
);

/** Whether Azure can be offered at all. */
const azureAvailable = computed(
  () =>
    settingsStore.azureEnabled &&
    Boolean(settingsStore.azureKey) &&
    Boolean(settingsStore.azureRegion),
);

const providerOptions = computed(() => {
  const options: Array<{ title: string; value: TtsProviderId; subtitle?: string }> = [
    { title: t("common.providerEdge"), value: "edge" },
  ];
  if (azureAvailable.value) {
    options.push({
      title: t("common.providerAzure"),
      value: "azure",
    });
  }
  return options;
});

/**
 * Every locale of the active catalog, with the number of voices it provides.
 *
 * Selecting the locale here belongs to the role being edited. It used to be
 * inherited from the single-speaker panel, which meant assigning an English
 * voice to one character forced every other role to become English too.
 */
const localeOptions = computed(() => {
  const groups = activeVoiceGroups.value;
  const byLocale = new Map(groups.map((voices) => [voices[0].Locale, voices.length]));

  const order = [
    ...PREFERRED_LOCALES.filter((locale) => byLocale.has(locale)),
    ...[...byLocale.keys()].filter((locale) => !PREFERRED_LOCALES.includes(locale)).sort(),
  ];

  return order.map((locale) => ({
    title: t("dialogue.cast.localeOption", { locale, count: byLocale.get(locale) ?? 0 }),
    value: locale,
  }));
});

/** Voices of the locale currently chosen in the role dialog. */
const voiceOptions = computed(() => {
  const voices = activeVoiceGroups.value.find((group) => group[0].Locale === roleFormLocale.value);
  if (!voices) {
    return [];
  }
  return voices.map((voice) => ({
    title: `${voice.FriendlyName || voice.ShortName} · ${voice.ShortName}`,
    value: voice.ShortName,
  }));
});

/**
 * The locale of a voice. Prefers both catalogs, falls back to the locale prefix
 * of an Edge voice id (`zh-CN-YunxiNeural`), so the cast still renders its
 * language before a catalog has finished loading.
 */
function localeOfVoice(shortName: string): string {
  const fromCatalog =
    voicesStore.voices.find((voice) => voice.ShortName === shortName)?.Locale ??
    voicesStore.azureVoices.find((voice) => voice.ShortName === shortName)?.Locale;
  if (fromCatalog) {
    return fromCatalog;
  }
  return /^([a-z]{2,3}-[A-Za-z]{2,4})-/.exec(shortName)?.[1] ?? "";
}

function pickDefaultLocale(): string {
  // Start from the voice of the most recently added role, so a second
  // character defaults to the same language as the first one.
  const lastRole = dialogueStore.roles[dialogueStore.roles.length - 1];
  const fromLastRole = lastRole ? localeOfVoice(lastRole.voice) : "";
  if (fromLastRole && activeVoiceGroups.value.some((group) => group[0].Locale === fromLastRole)) {
    return fromLastRole;
  }
  const firstPreferred = PREFERRED_LOCALES.find((locale) =>
    activeVoiceGroups.value.some((group) => group[0].Locale === locale),
  );
  return firstPreferred ?? activeVoiceGroups.value[0]?.[0]?.Locale ?? roleFormLocale.value;
}

/** Keeps the voice valid whenever the provider or the locale changes. */
function syncVoiceToLocale() {
  const voices = activeVoiceGroups.value.find((group) => group[0].Locale === roleFormLocale.value);
  if (!voices || voices.length === 0) {
    return;
  }
  const stillValid = voices.some((voice) => voice.ShortName === roleFormVoice.value);
  if (!stillValid) {
    roleFormVoice.value = voices[0].ShortName;
  }
}

/** Switching the provider invalidates both the locale and the voice. */
function handleProviderChange() {
  roleFormLocale.value = pickDefaultLocale();
  roleFormVoice.value = "";
  syncVoiceToLocale();
}

/** Locale shown on a role card, independent of catalog load timing. */
function roleLocale(role: DialogueRole): string {
  return role.locale || localeOfVoice(role.voice) || "—";
}

/**
 * The voice catalog used to be loaded only by the single-speaker panel, so
 * opening the cast on a fresh launch left every picker empty.
 */
onMounted(() => {
  void voicesStore.fetchVoices();
});

const totalChars = computed(() =>
  dialogueStore.lines.reduce((sum, line) => sum + line.text.length, 0),
);

function getRoleById(roleId: string): DialogueRole {
  return (
    dialogueStore.roles.find((r) => r.id === roleId) ||
    dialogueStore.roles[0] || {
      id: "unknown",
      name: t("dialogue.cast.unknownRole"),
      voice: "",
      rate: 0,
      pitch: 0,
      volume: 0,
      color: "grey",
    }
  );
}

function openAddRoleDialog() {
  isEditingRole.value = false;
  editingRoleId.value = "";
  roleFormName.value = "";
  roleFormProvider.value = "edge";
  roleFormLocale.value = pickDefaultLocale();
  syncVoiceToLocale();
  roleFormRate.value = 0;
  roleFormPitch.value = 0;
  roleFormVolume.value = 0;
  roleFormColor.value = colorOptions[dialogueStore.roles.length % colorOptions.length];
  roleFormIsDefault.value = false;
  showRoleDialog.value = true;
}

function openEditRoleDialog(role: DialogueRole) {
  isEditingRole.value = true;
  editingRoleId.value = role.id;
  roleFormName.value = role.name;
  roleFormProvider.value = role.provider === "azure" && azureAvailable.value ? "azure" : "edge";
  roleFormVoice.value = role.voice;
  // Derive the locale from the role's own voice instead of the panel, so the
  // dialog reflects the character rather than the last single-speaker pick.
  roleFormLocale.value = localeOfVoice(role.voice) || pickDefaultLocale();
  syncVoiceToLocale();
  roleFormRate.value = role.rate;
  roleFormPitch.value = role.pitch;
  roleFormVolume.value = role.volume;
  roleFormColor.value = role.color;
  roleFormIsDefault.value = Boolean(role.isDefault);
  showRoleDialog.value = true;
}

function saveRole() {
  const name = roleFormName.value.trim();
  if (!name) {
    message.error(t("dialogue.cast.roleNameRequired"));
    return;
  }

  const payload = {
    name,
    voice: roleFormVoice.value,
    locale: roleFormLocale.value,
    provider: roleFormProvider.value,
    rate: roleFormRate.value,
    pitch: roleFormPitch.value,
    volume: roleFormVolume.value,
    color: roleFormColor.value,
    isDefault: roleFormIsDefault.value,
  };

  if (isEditingRole.value) {
    dialogueStore.updateRole(editingRoleId.value, payload);
  } else {
    dialogueStore.addRole(payload);
  }

  showRoleDialog.value = false;
}

function deleteRole(roleId: string) {
  if (dialogueStore.roles.length <= 1) {
    message.warning(t("dialogue.cast.minimumRole"));
    return;
  }
  dialogueStore.removeRole(roleId);
}

function confirmImportScript() {
  if (!importText.value.trim()) {
    message.warning(t("dialogue.script.importRequired"));
    return;
  }

  const result = dialogueStore.parseScriptText(importText.value, importMode.value);
  if (!result.ok) {
    message.error(t("dialogue.script.importEmpty"));
    return;
  }

  showImportDialog.value = false;
  importText.value = "";
  activeTab.value = "script";
  message.success(t("dialogue.script.importSuccess", { count: result.count }));
}

async function exportAudioFile() {
  if (!dialogueStore.audioBytes) {
    return;
  }

  try {
    const ext = settingsStore.outputFormat;
    const filePath = await save({
      defaultPath: `${t("dialogue.actions.defaultFileNameBase")}_${Date.now()}.${ext}`,
      filters: [{ name: "Audio", extensions: [ext] }],
    });

    if (!filePath) {
      return;
    }

    const bgmOptions = bgmStore.isConfigured
      ? {
          enabled: bgmStore.enabled,
          bgmPath: bgmStore.bgmPath,
          bgmVolume: bgmStore.bgmVolume,
          enableDucking: bgmStore.enableDucking,
          duckingRatio: bgmStore.duckingRatio,
          duckingThreshold: bgmStore.duckingThreshold,
          fadeOutSec: bgmStore.fadeOutSec,
        }
      : undefined;

    const { cleanupError } = await saveAudioBytes(
      dialogueStore.audioBytes,
      filePath,
      ext,
      bgmOptions,
    );
    if (cleanupError) {
      throw new Error(cleanupError);
    }

    message.success(t("dialogue.actions.successExport", { path: filePath }));
  } catch (err) {
    message.error(
      t("dialogue.actions.synthesisFailed", {
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

async function exportScriptFile() {
  if (dialogueStore.lines.length === 0) {
    return;
  }

  try {
    const filePath = await save({
      defaultPath: `${t("dialogue.actions.defaultFileNameBase")}.txt`,
      filters: [{ name: "Text", extensions: ["txt"] }],
    });

    if (!filePath) {
      return;
    }

    const content = formatScript(dialogueStore.lines, dialogueStore.roles);
    await invoke("write_text_file", { path: filePath, content });
    message.success(t("dialogue.actions.successExport", { path: filePath }));
  } catch (err) {
    message.error(
      t("dialogue.actions.synthesisFailed", {
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

async function exportSubtitlesFile(format: "srt" | "vtt" = "srt") {
  const content = format === "vtt" ? dialogueStore.subtitles?.vtt : dialogueStore.subtitles?.srt;
  if (!content) {
    return;
  }

  try {
    const filePath = await save({
      defaultPath: `${t("dialogue.actions.defaultFileNameBase")}_${Date.now()}.${format}`,
      filters: [{ name: "Subtitles", extensions: [format] }],
    });

    if (!filePath) {
      return;
    }

    await invoke("write_text_file", { path: filePath, content });
    message.success(t("dialogue.actions.successExport", { path: filePath }));
  } catch (err) {
    message.error(
      t("dialogue.actions.synthesisFailed", {
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
</script>

<template>
  <v-container fluid class="dialogue-page pa-3">
    <!-- Compact Header Toolbar -->
    <v-card variant="outlined" class="hero-card mb-3" rounded="xl">
      <!--
        The title row and the action row are separate blocks on purpose. In a
        single flex row the action group had to compete with the title for
        the horizontal space, which left the primary action orphaned on a
        line of its own in the English layout.
      -->
      <div class="d-flex align-center justify-space-between ga-3 px-4 pt-2-5">
        <div class="d-flex align-center ga-3 min-w-0">
          <v-avatar color="primary" variant="tonal" size="38">
            <v-icon size="22">mdi-account-voice</v-icon>
          </v-avatar>
          <div class="min-w-0">
            <div class="d-flex align-center ga-2 flex-wrap">
              <span class="text-subtitle-1 font-weight-bold">{{ $t("dialogue.hero.title") }}</span>
              <v-chip size="x-small" color="primary" variant="tonal" class="font-weight-medium">
                {{
                  $t("dialogue.script.lineCount", {
                    lines: dialogueStore.lines.length,
                    chars: totalChars,
                  })
                }}
              </v-chip>
            </div>
            <div class="hero-description text-caption text-medium-emphasis">
              {{ $t("dialogue.hero.description") }}
            </div>
          </div>
        </div>

        <!-- The primary action sits next to the title so it stays the
             most prominent element even when the secondary actions need a
             second row. -->
        <div class="flex-shrink-0">
          <v-btn
            v-if="!dialogueStore.synthesizing"
            color="primary"
            variant="flat"
            prepend-icon="mdi-waveform"
            size="small"
            :disabled="dialogueStore.lines.length === 0"
            @click="dialogueStore.synthesizeAll()"
          >
            {{ $t("dialogue.actions.synthesizeAll") }}
          </v-btn>
          <v-btn
            v-else
            color="error"
            variant="flat"
            prepend-icon="mdi-stop"
            size="small"
            @click="dialogueStore.stopSynthesis()"
          >
            {{ $t("dialogue.actions.stop") }}
          </v-btn>
        </div>
      </div>

      <div class="d-flex flex-wrap align-center ga-2 px-4 pb-2-5 mt-1">
        <!--
            The secondary actions share one look: outlined, same size, each
            with an icon. Mixing a tonal button and an icon-less button into
            the group made the row look like four unrelated controls.
          -->
        <!-- Cast Presets Menu -->
        <v-menu>
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              variant="outlined"
              prepend-icon="mdi-palette-swatch-outline"
              size="small"
            >
              {{ $t("dialogue.cast.presets") }}
            </v-btn>
          </template>
          <v-list density="compact">
            <v-list-item
              v-for="p in presetOptions"
              :key="p.value"
              :title="p.title"
              :subtitle="p.subtitle"
              @click="dialogueStore.applyPreset(p.value)"
            />
          </v-list>
        </v-menu>

        <v-btn
          variant="outlined"
          prepend-icon="mdi-script-text-outline"
          size="small"
          @click="showImportDialog = true"
        >
          {{ $t("dialogue.script.importScript") }}
        </v-btn>

        <v-btn
          variant="outlined"
          prepend-icon="mdi-backspace"
          size="small"
          :disabled="dialogueStore.lines.length === 0"
          @click="dialogueStore.clearLines()"
        >
          {{ $t("dialogue.script.clearScript") }}
        </v-btn>

        <v-btn
          variant="outlined"
          prepend-icon="mdi-file-document-outline"
          size="small"
          :disabled="dialogueStore.lines.length === 0"
          @click="exportScriptFile"
        >
          {{ $t("dialogue.actions.exportScript") }}
        </v-btn>
      </div>

      <!-- Synthesis Progress Alert -->
      <v-progress-linear
        v-if="dialogueStore.synthesizing"
        color="primary"
        indeterminate
        height="3"
      />
      <div
        v-if="dialogueStore.synthesizing"
        class="px-4 py-1.5 bg-primary-subtle text-caption d-flex align-center justify-space-between"
      >
        <span>
          {{
            $t("dialogue.actions.synthesizing", {
              current: dialogueStore.progress.current,
              total: dialogueStore.progress.total,
              role: dialogueStore.progress.roleName,
            })
          }}
          : {{ dialogueStore.progress.lineText }}
        </span>
      </div>

      <!-- Failed Lines Alert -->
      <v-alert
        v-if="dialogueStore.failedLineIds.length > 0"
        type="warning"
        variant="tonal"
        density="compact"
        class="mt-3"
        closable
      >
        {{ $t("dialogue.actions.failedLines", { count: dialogueStore.failedLineIds.length }) }}
      </v-alert>
    </v-card>

    <!-- Studio Tab Container -->
    <v-card variant="outlined" class="main-studio-card glass-panel" rounded="xl">
      <div class="studio-tab-header border-b px-2 d-flex align-center justify-space-between">
        <v-tabs v-model="activeTab" color="primary" density="comfortable">
          <v-tab value="script" class="font-weight-medium">
            <v-icon start size="18">mdi-script-text-outline</v-icon>
            {{ $t("dialogue.script.title") }}
            <v-badge :content="dialogueStore.lines.length" color="primary" inline class="ml-2" />
          </v-tab>
          <v-tab value="cast" class="font-weight-medium">
            <v-icon start size="18">mdi-account-group-outline</v-icon>
            {{ $t("dialogue.cast.title") }}
            <v-badge :content="dialogueStore.roles.length" color="secondary" inline class="ml-2" />
          </v-tab>
          <v-tab value="bgm" class="font-weight-medium">
            <v-icon start size="18">mdi-music</v-icon>
            {{ $t("bgm.cardTitle") }}
            <v-badge v-if="bgmStore.isConfigured" dot color="success" inline class="ml-2" />
          </v-tab>
        </v-tabs>

        <!-- Right Quick Tip / Status -->
        <div class="d-none d-sm-flex align-center pr-2 text-caption text-medium-emphasis ga-3">
          <span v-if="bgmStore.isConfigured" class="text-success d-flex align-center ga-1">
            <v-icon size="14">mdi-music-note</v-icon>
            BGM: {{ bgmStore.bgmName }}
          </span>
          <span v-else class="text-disabled">{{ $t("bgm.notEnabled") }}</span>
        </div>
      </div>

      <!-- Tab Content Panes -->
      <!-- ================= TAB 1: 剧本台本工作台 ================= -->
      <div v-show="activeTab === 'script'" class="studio-tab-pane">
        <!-- Script Actions & Quick Role Bar -->
        <div
          class="script-actions-bar px-4 py-2 border-b d-flex flex-wrap align-center justify-space-between ga-2"
        >
          <div class="d-flex flex-wrap align-center ga-2">
            <v-btn
              variant="flat"
              color="primary"
              size="small"
              prepend-icon="mdi-plus"
              @click="dialogueStore.addLine()"
            >
              {{ $t("dialogue.script.addLine") }}
            </v-btn>

            <!-- Quick Append for Specific Role -->
            <span class="text-caption text-medium-emphasis ml-2">
              {{ $t("dialogue.script.quickAppend") }}
            </span>
            <v-chip
              v-for="role in dialogueStore.roles"
              :key="role.id"
              size="small"
              variant="tonal"
              :color="role.color"
              class="cursor-pointer"
              @click="dialogueStore.addLine(role.id)"
            >
              <v-avatar start size="16" :color="role.color" class="text-white text-caption">
                {{ role.name.slice(0, 1) }}
              </v-avatar>
              + {{ role.name }}
            </v-chip>
          </div>

          <div class="d-flex align-center ga-2">
            <span class="text-caption text-medium-emphasis">{{
              $t("dialogue.script.defaultPause")
            }}</span>
            <v-menu>
              <template #activator="{ props }">
                <v-chip
                  v-bind="props"
                  size="small"
                  variant="outlined"
                  class="cursor-pointer font-weight-bold"
                >
                  {{ dialogueStore.defaultPauseMs }} ms
                  <v-icon end size="12">mdi-chevron-down</v-icon>
                </v-chip>
              </template>
              <v-list density="compact">
                <v-list-item
                  v-for="ms in pauseOptions"
                  :key="ms"
                  :title="$t('dialogue.script.milliseconds', { ms })"
                  @click="dialogueStore.setDefaultPause(ms)"
                />
              </v-list>
            </v-menu>
          </div>
        </div>

        <!-- Script Lines List -->
        <div class="script-lines-scroll pa-3">
          <template v-if="dialogueStore.lines.length > 0">
            <div
              v-for="(line, index) in dialogueStore.lines"
              :key="line.id"
              class="dialogue-line-card mb-2 px-3 py-2 rounded-lg"
              :style="{
                borderLeft: `4px solid var(--v-theme-${getRoleById(line.roleId).color})`,
              }"
            >
              <!--
                Everything of a line sits on one row: index, speaker, text,
                pause and the actions. Stacking them vertically made every
                line about three times taller than the text it holds and left
                a wide empty gap between the speaker and the buttons.
              -->
              <div class="dialogue-line-row">
                <span class="dialogue-line-index">#{{ index + 1 }}</span>

                <!-- Quick Role Switcher Menu -->
                <v-menu>
                  <template #activator="{ props }">
                    <v-btn
                      v-bind="props"
                      size="small"
                      variant="tonal"
                      :color="getRoleById(line.roleId).color"
                      class="dialogue-line-role px-2 font-weight-bold"
                      append-icon="mdi-chevron-down"
                    >
                      <v-avatar
                        start
                        size="18"
                        :color="getRoleById(line.roleId).color"
                        class="text-white text-caption mr-1"
                      >
                        {{ getRoleById(line.roleId).name.slice(0, 1) }}
                      </v-avatar>
                      {{ getRoleById(line.roleId).name }}
                    </v-btn>
                  </template>
                  <v-list density="compact">
                    <v-list-item
                      v-for="r in dialogueStore.roles"
                      :key="r.id"
                      :title="r.name"
                      :subtitle="r.voice.split('-').pop()"
                      @click="dialogueStore.updateLine(line.id, { roleId: r.id })"
                    >
                      <template #prepend>
                        <v-avatar size="20" :color="r.color" class="mr-2 text-white text-caption">
                          {{ r.name.slice(0, 1) }}
                        </v-avatar>
                      </template>
                    </v-list-item>
                  </v-list>
                </v-menu>

                <v-textarea
                  v-model="line.text"
                  :placeholder="$t('dialogue.script.linePlaceholder')"
                  rows="1"
                  auto-grow
                  density="compact"
                  variant="outlined"
                  hide-details
                  class="dialogue-line-text"
                />

                <!-- Pause Selector Menu -->
                <v-menu>
                  <template #activator="{ props }">
                    <v-chip
                      v-bind="props"
                      size="small"
                      variant="outlined"
                      class="dialogue-line-pause cursor-pointer"
                    >
                      {{
                        $t("dialogue.script.pauseAfter", {
                          ms: line.pauseAfterMs || dialogueStore.defaultPauseMs,
                        })
                      }}
                      <v-icon end size="12">mdi-clock-outline</v-icon>
                    </v-chip>
                  </template>
                  <v-list density="compact">
                    <v-list-item
                      v-for="ms in pauseOptions"
                      :key="ms"
                      :title="$t('dialogue.script.milliseconds', { ms })"
                      @click="dialogueStore.updateLine(line.id, { pauseAfterMs: ms })"
                    />
                  </v-list>
                </v-menu>

                <!-- Actions -->
                <div class="dialogue-line-actions">
                  <v-btn
                    icon
                    size="x-small"
                    variant="text"
                    color="primary"
                    :loading="dialogueStore.auditioningLineId === line.id"
                    :title="$t('dialogue.script.audition')"
                    @click="dialogueStore.auditionLine(line.id)"
                  >
                    <v-icon size="16">mdi-play</v-icon>
                  </v-btn>
                  <v-btn
                    icon="mdi-plus"
                    size="x-small"
                    variant="text"
                    :title="$t('dialogue.script.insertAfter')"
                    @click="dialogueStore.insertLineAfter(index, line.roleId)"
                  />
                  <v-btn
                    icon="mdi-delete-outline"
                    size="x-small"
                    variant="text"
                    color="error"
                    :title="$t('dialogue.script.deleteLine')"
                    @click="dialogueStore.removeLine(line.id)"
                  />
                </div>
              </div>
            </div>
          </template>

          <div v-else class="text-center py-12 text-medium-emphasis">
            <v-icon size="48" class="mb-2">mdi-drama-masks</v-icon>
            <div class="text-body-1 font-weight-medium">
              {{ $t("dialogue.script.emptyTitle") }}
            </div>
            <div class="text-caption mb-4">
              {{ $t("dialogue.script.emptyDescription") }}
            </div>
            <div class="d-flex align-center justify-center ga-2">
              <v-btn
                color="primary"
                variant="flat"
                size="small"
                prepend-icon="mdi-script-text-outline"
                @click="showImportDialog = true"
              >
                {{ $t("dialogue.script.importScript") }}
              </v-btn>
              <v-btn
                variant="outlined"
                size="small"
                prepend-icon="mdi-plus"
                @click="dialogueStore.addLine()"
              >
                {{ $t("dialogue.script.addLine") }}
              </v-btn>
            </div>
          </div>
        </div>

        <!-- Bottom Audio Player & Export Bar -->
        <div
          v-if="dialogueStore.audioUrl"
          class="script-player-bar pa-3 border-t bg-surface d-flex flex-wrap align-center justify-space-between ga-3"
        >
          <div class="d-flex align-center ga-2" style="flex: 1; min-width: 280px">
            <v-icon color="primary">mdi-music-box-outline</v-icon>
            <audio :src="dialogueStore.audioUrl" controls style="flex: 1; height: 36px" />
          </div>
          <div class="d-flex align-center ga-2">
            <v-btn
              color="primary"
              variant="flat"
              size="small"
              prepend-icon="mdi-download"
              @click="exportAudioFile"
            >
              {{ $t("dialogue.actions.exportAudio") }}
            </v-btn>
            <v-btn
              variant="outlined"
              size="small"
              prepend-icon="mdi-subtitles-outline"
              @click="exportSubtitlesFile('srt')"
            >
              {{ $t("dialogue.actions.exportSubtitles") }}
            </v-btn>
            <v-btn
              variant="text"
              size="small"
              prepend-icon="mdi-subtitles-outline"
              @click="exportSubtitlesFile('vtt')"
            >
              {{ $t("dialogue.actions.exportVtt") }}
            </v-btn>
          </div>
        </div>
      </div>

      <!-- ================= TAB 2: 角色声优阵容 ================= -->
      <div v-show="activeTab === 'cast'" class="studio-tab-pane pa-4">
        <!-- Cast Header Actions -->
        <div class="d-flex flex-wrap align-center justify-space-between mb-4 ga-3 flex-shrink-0">
          <div>
            <div class="text-subtitle-1 font-weight-bold">
              {{ $t("dialogue.cast.title") }}
              <span class="text-caption font-weight-regular text-medium-emphasis ml-1">
                ({{ $t("dialogue.cast.roleCount", { count: dialogueStore.roles.length }) }})
              </span>
            </div>
            <div class="text-caption text-medium-emphasis">
              {{ $t("dialogue.cast.description") }}
            </div>
          </div>

          <div class="d-flex align-center ga-2">
            <v-btn
              color="primary"
              variant="flat"
              size="small"
              prepend-icon="mdi-plus"
              @click="openAddRoleDialog"
            >
              {{ $t("dialogue.cast.addRole") }}
            </v-btn>
          </div>
        </div>

        <!-- Cast Grid -->
        <div class="cast-grid-scroll pb-6">
          <v-row class="cast-grid">
            <v-col
              v-for="role in dialogueStore.roles"
              :key="role.id"
              cols="12"
              sm="6"
              md="4"
              lg="3"
            >
              <v-card variant="outlined" class="role-grid-card h-100" rounded="lg">
                <v-card-item class="pb-2">
                  <template #prepend>
                    <v-avatar :color="role.color" size="36" class="text-white font-weight-bold">
                      {{ role.name.slice(0, 1) }}
                    </v-avatar>
                  </template>

                  <v-card-title class="text-subtitle-2 font-weight-bold d-flex align-center ga-1">
                    <span class="text-truncate">{{ role.name }}</span>
                    <v-chip
                      v-if="role.isDefault"
                      size="x-small"
                      color="primary"
                      variant="flat"
                      class="px-1"
                    >
                      {{ $t("dialogue.cast.defaultBadge") }}
                    </v-chip>
                  </v-card-title>
                  <v-card-subtitle class="text-caption text-truncate">
                    {{ role.voice.replace("Neural", "").split("-").pop() }}
                  </v-card-subtitle>

                  <template #append>
                    <v-btn
                      icon="mdi-pencil-outline"
                      variant="text"
                      size="x-small"
                      @click="openEditRoleDialog(role)"
                    />
                    <v-btn
                      icon="mdi-delete-outline"
                      variant="text"
                      size="x-small"
                      color="error"
                      :disabled="dialogueStore.roles.length <= 1"
                      @click="deleteRole(role.id)"
                    />
                  </template>
                </v-card-item>

                <v-divider />

                <v-card-text class="pt-3 pb-2 text-caption">
                  <div class="d-flex align-center justify-space-between mb-1.5">
                    <span class="text-medium-emphasis">{{ $t("dialogue.cast.locale") }}</span>
                    <span class="font-weight-medium">{{ roleLocale(role) }}</span>
                  </div>
                  <div class="d-flex align-center justify-space-between mb-1.5">
                    <span class="text-medium-emphasis">{{ $t("dialogue.cast.voice") }}</span>
                    <span class="font-weight-medium text-truncate" style="max-width: 140px">
                      {{ role.voice }}
                    </span>
                  </div>
                  <div class="d-flex align-center justify-space-between mb-1.5">
                    <span class="text-medium-emphasis">{{ $t("dialogue.cast.rate") }}</span>
                    <span>{{ role.rate >= 0 ? `+${role.rate}%` : `${role.rate}%` }}</span>
                  </div>
                  <div class="d-flex align-center justify-space-between mb-1.5">
                    <span class="text-medium-emphasis">{{ $t("dialogue.cast.pitch") }}</span>
                    <span>{{ role.pitch >= 0 ? `+${role.pitch}Hz` : `${role.pitch}Hz` }}</span>
                  </div>
                </v-card-text>

                <v-divider />

                <v-card-actions class="px-3 py-2 d-flex justify-space-between">
                  <v-btn
                    size="x-small"
                    variant="tonal"
                    color="primary"
                    prepend-icon="mdi-plus"
                    @click="
                      dialogueStore.addLine(role.id);
                      activeTab = 'script';
                    "
                  >
                    {{ $t("dialogue.cast.writeLines") }}
                  </v-btn>
                  <v-btn
                    size="x-small"
                    variant="text"
                    prepend-icon="mdi-tune"
                    @click="openEditRoleDialog(role)"
                  >
                    {{ $t("dialogue.cast.configure") }}
                  </v-btn>
                </v-card-actions>
              </v-card>
            </v-col>

            <!-- Add Role Placeholder Card -->
            <v-col cols="12" sm="6" md="4" lg="3">
              <v-card
                variant="outlined"
                class="add-role-card h-100 d-flex flex-column align-center justify-center pa-6 cursor-pointer"
                rounded="lg"
                @click="openAddRoleDialog"
              >
                <v-avatar color="primary" variant="tonal" size="44" class="mb-2">
                  <v-icon size="24">mdi-plus</v-icon>
                </v-avatar>
                <div class="text-body-2 font-weight-bold">{{ $t("dialogue.cast.addRole") }}</div>
                <div class="text-caption text-medium-emphasis">
                  {{ $t("dialogue.cast.createNewCharacter") }}
                </div>
              </v-card>
            </v-col>
          </v-row>
        </div>
      </div>

      <!-- ================= TAB 3: 背景音乐与混音 ================= -->
      <div v-show="activeTab === 'bgm'" class="studio-tab-pane pa-4">
        <div class="bgm-tab-container pb-6">
          <!--
            The BGM card is built for a narrow column. Stretched across the
            full tab width its four strength buttons each grew to ~190px and
            the tips card was pushed out of the viewport, so the card is
            capped and the tips sit next to it.
          -->
          <div class="bgm-tab-grid">
            <BgmConfigCard :elevation="0" />

            <v-card variant="outlined" rounded="lg" class="pa-4 tips-card">
              <div class="d-flex align-center ga-2 mb-2">
                <v-icon color="primary" size="20">mdi-lightbulb-on-outline</v-icon>
                <span class="text-subtitle-2 font-weight-bold">{{
                  $t("dialogue.bgm.tipsTitle")
                }}</span>
              </div>
              <ul class="text-caption text-medium-emphasis pl-4" style="line-height: 1.8">
                <li>{{ $t("dialogue.bgm.tipsFormat") }}</li>
                <li>{{ $t("dialogue.bgm.tipsDucking") }}</li>
                <li>{{ $t("dialogue.bgm.tipsExport") }}</li>
              </ul>
            </v-card>
          </div>
        </div>
      </div>
    </v-card>

    <!-- Script Import Modal -->
    <v-dialog v-model="showImportDialog" max-width="650">
      <v-card rounded="xl" class="glass-panel">
        <v-card-item>
          <v-card-title class="text-h6 font-weight-bold">
            {{ $t("dialogue.script.importModalTitle") }}
          </v-card-title>
          <template #append>
            <v-btn icon="mdi-close" variant="text" size="small" @click="showImportDialog = false" />
          </template>
        </v-card-item>
        <v-divider />
        <v-card-text class="pa-4">
          <v-radio-group v-model="importMode" density="compact" class="mb-3">
            <v-radio
              value="prefix"
              :label="$t('dialogue.script.importModePrefix')"
              color="primary"
            />
            <v-radio
              value="quotes"
              :label="$t('dialogue.script.importModeQuotes')"
              color="primary"
            />
          </v-radio-group>

          <v-textarea
            v-model="importText"
            rows="8"
            variant="outlined"
            density="compact"
            :placeholder="$t('dialogue.script.importPlaceholder')"
            hide-details
          />
        </v-card-text>
        <v-divider />
        <v-card-actions class="pa-4 d-flex justify-end ga-2">
          <v-btn variant="outlined" @click="showImportDialog = false">
            {{ $t("dialogue.cast.cancel") }}
          </v-btn>
          <v-btn color="primary" variant="flat" @click="confirmImportScript">
            {{ $t("dialogue.script.importConfirm") }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Role Config Modal -->
    <v-dialog v-model="showRoleDialog" max-width="500">
      <v-card rounded="xl" class="glass-panel">
        <v-card-item>
          <v-card-title class="text-h6 font-weight-bold">
            {{ isEditingRole ? $t("dialogue.cast.editRole") : $t("dialogue.cast.addRole") }}
          </v-card-title>
          <template #append>
            <v-btn icon="mdi-close" variant="text" size="small" @click="showRoleDialog = false" />
          </template>
        </v-card-item>
        <v-divider />
        <v-card-text class="pa-4">
          <v-text-field
            v-model="roleFormName"
            :label="$t('dialogue.cast.roleName')"
            variant="outlined"
            density="compact"
            class="mb-3"
            placeholder="例如：萧炎"
          />

          <v-select
            v-if="providerOptions.length > 1"
            v-model="roleFormProvider"
            :items="providerOptions"
            :label="$t('common.provider')"
            variant="outlined"
            density="compact"
            class="mb-3"
            @update:model-value="handleProviderChange"
          />

          <v-select
            v-model="roleFormLocale"
            :items="localeOptions"
            :label="$t('dialogue.cast.locale')"
            variant="outlined"
            density="compact"
            class="mb-3"
            @update:model-value="syncVoiceToLocale"
          />

          <v-select
            v-model="roleFormVoice"
            :items="voiceOptions"
            :label="$t('dialogue.cast.voice')"
            variant="outlined"
            density="compact"
            class="mb-3"
            :menu-props="{ maxHeight: 320 }"
            :no-data-text="$t('dialogue.cast.noVoiceInLocale')"
          />

          <div class="mb-3">
            <div class="d-flex justify-space-between text-caption mb-1">
              <span>{{ $t("dialogue.cast.rate") }}</span>
              <span>{{ roleFormRate >= 0 ? `+${roleFormRate}%` : `${roleFormRate}%` }}</span>
            </div>
            <v-slider
              v-model="roleFormRate"
              :min="-50"
              :max="100"
              :step="1"
              color="primary"
              hide-details
            />
          </div>

          <div class="mb-3">
            <div class="d-flex justify-space-between text-caption mb-1">
              <span>{{ $t("dialogue.cast.pitch") }}</span>
              <span>{{ roleFormPitch >= 0 ? `+${roleFormPitch}Hz` : `${roleFormPitch}Hz` }}</span>
            </div>
            <v-slider
              v-model="roleFormPitch"
              :min="-50"
              :max="50"
              :step="1"
              color="primary"
              hide-details
            />
          </div>

          <v-select
            v-model="roleFormColor"
            :items="colorSelectItems"
            :label="$t('dialogue.cast.color')"
            variant="outlined"
            density="compact"
            class="mb-3"
          >
            <template #item="{ props: itemProps, item }">
              <v-list-item v-bind="itemProps">
                <template #prepend>
                  <v-avatar :color="item.value" size="18" class="mr-2" />
                </template>
              </v-list-item>
            </template>
            <template #selection="{ item }">
              <div class="d-flex align-center ga-2">
                <v-avatar :color="item.value" size="16" />
                <span>{{ item.title }}</span>
              </div>
            </template>
          </v-select>

          <v-checkbox
            v-model="roleFormIsDefault"
            :label="$t('dialogue.cast.isDefault')"
            density="compact"
            color="primary"
            hide-details
          />
        </v-card-text>
        <v-divider />
        <v-card-actions class="pa-4 d-flex justify-end ga-2">
          <v-btn variant="outlined" @click="showRoleDialog = false">
            {{ $t("dialogue.cast.cancel") }}
          </v-btn>
          <v-btn color="primary" variant="flat" @click="saveRole">
            {{ $t("dialogue.cast.save") }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.dialogue-page {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  padding: 12px;
  box-sizing: border-box;
}

.hero-card {
  background: rgba(var(--v-theme-surface), 0.95);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  flex-shrink: 0;
}

.main-studio-card {
  background: rgba(var(--v-theme-surface), 0.96);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  display: flex;
  flex-direction: column;
  margin-bottom: 32px;
}

.studio-tab-header {
  background: rgba(var(--v-theme-surface), 0.96);
  backdrop-filter: blur(16px);
  position: sticky;
  top: 0;
  z-index: 10;
  border-top-left-radius: inherit;
  border-top-right-radius: inherit;
}

.studio-tab-pane {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.script-actions-bar {
  background: rgba(var(--v-theme-surface), 0.96);
  backdrop-filter: blur(12px);
  position: sticky;
  top: 48px;
  z-index: 9;
}

.script-lines-scroll {
  width: 100%;
}

.script-player-bar {
  position: sticky;
  bottom: 0;
  z-index: 10;
  background: rgba(var(--v-theme-surface), 0.98);
  backdrop-filter: blur(16px);
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.08);
}

.tips-card {
  background: rgba(var(--v-theme-primary), 0.04);
  border: 1px solid rgba(var(--v-theme-primary), 0.16) !important;
}

.cast-grid-scroll {
  width: 100%;
}

/*
 * The description is capped so that the title block stays narrow enough for
 * the primary action to sit next to it. Without the cap the long English
 * text pushed the action onto its own row.
 */
.hero-description {
  max-width: 460px;
}

.dialogue-line-card {
  background: rgba(var(--v-theme-surface), 0.9);
  border: 1px solid rgba(var(--v-border-color), 0.4);
  transition: all 0.2s ease;
}

.dialogue-line-card:hover {
  background: rgba(var(--v-theme-surface), 1);
  box-shadow: 0 4px 12px rgba(var(--v-theme-on-surface), 0.05);
}

/*
 * One row per line: index, speaker, text, pause, actions. The text field
 * takes the space that used to sit empty between the speaker and the
 * buttons, and a line now needs about a third of the vertical room.
 */
.dialogue-line-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.dialogue-line-index {
  flex: 0 0 auto;
  min-width: 26px;
  text-align: right;
  font-size: 12px;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.dialogue-line-role {
  flex: 0 0 auto;
  max-width: 150px;
}

.dialogue-line-text {
  flex: 1 1 auto;
  min-width: 0;
}

/* The textarea is the only element that may wrap onto more rows. */
.dialogue-line-text :deep(textarea) {
  overflow-y: hidden;
}

.dialogue-line-pause {
  flex: 0 0 auto;
  white-space: nowrap;
}

.dialogue-line-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 2px;
  /* Out of the way until the line is hovered. */
  opacity: 0.5;
  transition: opacity 0.15s ease;
}

.dialogue-line-card:hover .dialogue-line-actions,
.dialogue-line-card:focus-within .dialogue-line-actions {
  opacity: 1;
}

@media (max-width: 860px) {
  .dialogue-line-row {
    flex-wrap: wrap;
  }

  .dialogue-line-text {
    order: 3;
    flex-basis: 100%;
  }
}

.role-grid-card {
  border: 1px solid rgba(var(--v-border-color), 0.6);
  background: rgba(var(--v-theme-surface), 0.85);
  transition: all 0.2s ease;
}

.role-grid-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.5);
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(var(--v-theme-on-surface), 0.06);
}

.add-role-card {
  border: 2px dashed rgba(var(--v-border-color), 0.8);
  background: rgba(var(--v-theme-primary), 0.04);
  transition: all 0.2s ease;
  min-height: 180px;
}

.add-role-card:hover {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
}

.bgm-tab-container {
  max-width: 980px;
  margin: 0 auto;
  width: 100%;
}

/*
 * The BGM card keeps a comfortable reading width and the mixing tips sit
 * beside it, instead of both being stretched across the whole tab.
 */
.bgm-tab-grid {
  display: grid;
  grid-template-columns: minmax(0, 520px) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

@media (max-width: 900px) {
  .bgm-tab-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.cursor-pointer {
  cursor: pointer;
}
</style>
