<script setup lang="ts">
import { computed, ref } from "vue";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useMessage } from "vuetify-message-vue3";
import type { DialogueRole } from "../types";
import { DEFAULT_CAST_PRESETS } from "../constants/dialoguePresets";
import { useDialogueStore } from "../stores/dialogue";
import { useVoicesStore } from "../stores/voices";
import { useSettingsStore } from "../stores/settings";
import { useBgmStore } from "../stores/bgm";
import { saveAudioBytes } from "../utils/saveAudio";
import BgmConfigCard from "../components/common/BgmConfigCard.vue";

const dialogueStore = useDialogueStore();
const voicesStore = useVoicesStore();
const settingsStore = useSettingsStore();
const bgmStore = useBgmStore();
const message = useMessage();

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

const presetOptions = computed(() =>
  DEFAULT_CAST_PRESETS.map((p) => ({
    title: p.name,
    subtitle: p.description,
    value: p.id,
  })),
);

const voiceOptions = computed(() => {
  const list =
    voicesStore.filteredVoices.length > 0 ? voicesStore.filteredVoices : voicesStore.voices;
  if (list.length === 0) {
    return [
      { title: "云希 (zh-CN-YunxiNeural)", value: "zh-CN-YunxiNeural" },
      { title: "云扬 (zh-CN-YunyangNeural)", value: "zh-CN-YunyangNeural" },
      { title: "云健 (zh-CN-YunjianNeural)", value: "zh-CN-YunjianNeural" },
      { title: "云泽 (zh-CN-YunzeNeural)", value: "zh-CN-YunzeNeural" },
      { title: "晓晓 (zh-CN-XiaoxiaoNeural)", value: "zh-CN-XiaoxiaoNeural" },
      { title: "晓伊 (zh-CN-XiaoyiNeural)", value: "zh-CN-XiaoyiNeural" },
    ];
  }
  return list.map((v) => ({
    title: `${v.FriendlyName || v.ShortName} (${v.Locale})`,
    value: v.ShortName,
  }));
});

const totalChars = computed(() =>
  dialogueStore.lines.reduce((sum, line) => sum + line.text.length, 0),
);

function getRoleById(roleId: string): DialogueRole {
  return (
    dialogueStore.roles.find((r) => r.id === roleId) ||
    dialogueStore.roles[0] || {
      id: "unknown",
      name: "未知",
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
  roleFormVoice.value = voicesStore.selectedVoice || "zh-CN-YunxiNeural";
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
  roleFormVoice.value = role.voice;
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
    message.error("请输入角色姓名");
    return;
  }

  if (isEditingRole.value) {
    dialogueStore.updateRole(editingRoleId.value, {
      name,
      voice: roleFormVoice.value,
      rate: roleFormRate.value,
      pitch: roleFormPitch.value,
      volume: roleFormVolume.value,
      color: roleFormColor.value,
      isDefault: roleFormIsDefault.value,
    });
  } else {
    dialogueStore.addRole({
      name,
      voice: roleFormVoice.value,
      rate: roleFormRate.value,
      pitch: roleFormPitch.value,
      volume: roleFormVolume.value,
      color: roleFormColor.value,
      isDefault: roleFormIsDefault.value,
    });
  }

  showRoleDialog.value = false;
}

function deleteRole(roleId: string) {
  if (dialogueStore.roles.length <= 1) {
    message.warning("至少保留一位角色");
    return;
  }
  dialogueStore.removeRole(roleId);
}

function confirmImportScript() {
  if (!importText.value.trim()) {
    message.warning("请输入台本或小说文本");
    return;
  }

  dialogueStore.parseScriptText(importText.value, importMode.value);
  showImportDialog.value = false;
  importText.value = "";
  activeTab.value = "script";
  message.success(`成功导入 ${dialogueStore.lines.length} 句对白！`);
}

async function exportAudioFile() {
  if (!dialogueStore.audioBytes) {
    return;
  }

  try {
    const ext = settingsStore.outputFormat;
    const filePath = await save({
      defaultPath: `多角色广播剧_${Date.now()}.${ext}`,
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

    message.success(`音频文件已成功保存到：${filePath}`);
  } catch (err) {
    message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

async function exportSubtitlesFile() {
  const srt = dialogueStore.subtitles?.srt;
  if (!srt) {
    return;
  }

  try {
    const filePath = await save({
      defaultPath: `多角色广播剧_${Date.now()}.srt`,
      filters: [{ name: "Subtitles", extensions: ["srt"] }],
    });

    if (!filePath) {
      return;
    }

    await invoke("write_text_file", { path: filePath, content: srt });
    message.success(`字幕文件已成功保存到：${filePath}`);
  } catch (err) {
    message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
  }
}
</script>

<template>
  <v-container fluid class="dialogue-page pa-3">
    <!-- Compact Header Toolbar -->
    <v-card variant="outlined" class="hero-card mb-3" rounded="xl">
      <div class="d-flex flex-wrap align-center justify-space-between ga-3 px-4 py-2-5">
        <div class="d-flex align-center ga-3">
          <v-avatar color="primary" variant="tonal" size="38">
            <v-icon size="22">mdi-account-voice</v-icon>
          </v-avatar>
          <div>
            <div class="d-flex align-center ga-2">
              <span class="text-subtitle-1 font-weight-bold">{{ $t("dialogue.hero.title") }}</span>
              <v-chip size="x-small" color="primary" variant="tonal" class="font-weight-medium">
                {{ dialogueStore.lines.length }} 句台词 · {{ dialogueStore.roles.length }} 位角色 ·
                约 {{ totalChars }} 字
              </v-chip>
            </div>
            <div class="text-caption text-medium-emphasis">
              {{ $t("dialogue.hero.description") }}
            </div>
          </div>
        </div>

        <div class="d-flex flex-wrap align-center ga-2">
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
            variant="tonal"
            color="primary"
            prepend-icon="mdi-script-text-outline"
            size="small"
            @click="showImportDialog = true"
          >
            {{ $t("dialogue.script.importScript") }}
          </v-btn>

          <v-btn
            variant="outlined"
            size="small"
            :disabled="dialogueStore.lines.length === 0"
            @click="dialogueStore.clearLines()"
          >
            清空台本
          </v-btn>

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
          <span v-else class="text-disabled">BGM: 未启用</span>
        </div>
      </div>

      <!-- Tab Content Panes -->
      <!-- ================= TAB 1: 剧本台本工作台 ================= -->
      <div v-show="activeTab === 'script'" class="studio-tab-pane">
        <!-- Script Actions & Quick Role Bar -->
        <div
          class="script-actions-bar px-4 py-2 border-b bg-surface-variant-subtle d-flex flex-wrap align-center justify-space-between ga-2"
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
            <span class="text-caption text-medium-emphasis ml-2">快速追加台词：</span>
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
            <span class="text-caption text-medium-emphasis"
              >默认停顿：{{ dialogueStore.defaultPauseMs }}ms</span
            >
          </div>
        </div>

        <!-- Script Lines List -->
        <div class="script-lines-scroll pa-4">
          <template v-if="dialogueStore.lines.length > 0">
            <div
              v-for="(line, index) in dialogueStore.lines"
              :key="line.id"
              class="dialogue-line-card mb-3 pa-3 rounded-lg"
              :style="{
                borderLeft: `4px solid var(--v-theme-${getRoleById(line.roleId).color})`,
              }"
            >
              <div class="d-flex align-center justify-space-between mb-2">
                <div class="d-flex align-center ga-2">
                  <span class="text-caption text-medium-emphasis font-weight-bold">
                    #{{ index + 1 }}
                  </span>

                  <!-- Quick Role Switcher Menu -->
                  <v-menu>
                    <template #activator="{ props }">
                      <v-btn
                        v-bind="props"
                        size="small"
                        variant="tonal"
                        :color="getRoleById(line.roleId).color"
                        class="px-2 font-weight-bold"
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

                  <!-- Pause Selector Menu -->
                  <v-menu>
                    <template #activator="{ props }">
                      <v-chip
                        v-bind="props"
                        size="x-small"
                        variant="outlined"
                        class="text-caption cursor-pointer"
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
                        :title="`${ms} 毫秒`"
                        @click="dialogueStore.updateLine(line.id, { pauseAfterMs: ms })"
                      />
                    </v-list>
                  </v-menu>
                </div>

                <!-- Actions -->
                <div class="d-flex align-center ga-1">
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

              <v-textarea
                v-model="line.text"
                rows="2"
                auto-grow
                density="compact"
                variant="outlined"
                hide-details
                class="dialogue-textarea"
              />
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
              @click="exportSubtitlesFile"
            >
              {{ $t("dialogue.actions.exportSubtitles") }}
            </v-btn>
          </div>
        </div>
      </div>

      <!-- ================= TAB 2: 角色声优阵容 ================= -->
      <div v-show="activeTab === 'cast'" class="studio-tab-pane studio-tab-pane--scroll pa-4">
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
              为剧本中的每位登场人物分配专属声音、语调与情感色彩。
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
        <div class="cast-grid-scroll">
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
                    撰写台词
                  </v-btn>
                  <v-btn
                    size="x-small"
                    variant="text"
                    prepend-icon="mdi-tune"
                    @click="openEditRoleDialog(role)"
                  >
                    配置
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
                <div class="text-caption text-medium-emphasis">创建新登场人物</div>
              </v-card>
            </v-col>
          </v-row>
        </div>
      </div>

      <!-- ================= TAB 3: 背景音乐与混音 ================= -->
      <div v-show="activeTab === 'bgm'" class="studio-tab-pane studio-tab-pane--scroll pa-4">
        <div class="bgm-tab-container">
          <BgmConfigCard :elevation="0" class="mb-4" />

          <!-- Helpful mixing tips card -->
          <v-card variant="outlined" rounded="lg" class="pa-4 bg-surface-variant-subtle">
            <div class="d-flex align-center ga-2 mb-2">
              <v-icon color="primary" size="20">mdi-lightbulb-on-outline</v-icon>
              <span class="text-subtitle-2 font-weight-bold">广播剧混音与人声避让技巧</span>
            </div>
            <ul class="text-caption text-medium-emphasis pl-4" style="line-height: 1.8">
              <li>推荐选用 44.1kHz 的立体声轻音乐、OST 或环境音效作为背景伴奏。</li>
              <li>
                <strong>人声智能避让（Audio Ducking）</strong
                >：说话时自动以侧链压缩压低伴奏音量（如标准
                -12dB），在对白停顿与全剧结尾时平滑回升，保证台词清晰自然。
              </li>
              <li>
                在「剧本台本工作台」点击「合成广播剧音频」后，点击「导出音频」将全自动完成混音并保存。
              </li>
            </ul>
          </v-card>
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
            v-model="roleFormVoice"
            :items="voiceOptions"
            :label="$t('dialogue.cast.voice')"
            variant="outlined"
            density="compact"
            class="mb-3"
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
            :items="colorOptions"
            :label="$t('dialogue.cast.color')"
            variant="outlined"
            density="compact"
            class="mb-3"
          >
            <template #item="{ props, item }">
              <v-list-item v-bind="props">
                <template #prepend>
                  <v-avatar :color="item.value" size="18" class="mr-2" />
                </template>
              </v-list-item>
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
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  box-sizing: border-box;
}

.hero-card {
  background: rgba(var(--v-theme-surface), 0.95);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  flex-shrink: 0;
}

.main-studio-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 400px;
  overflow: hidden;
  background: rgba(var(--v-theme-surface), 0.96);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.studio-tab-header {
  background: rgba(var(--v-theme-surface), 0.8);
  flex-shrink: 0;
}

.studio-tab-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.studio-tab-pane--scroll {
  overflow-y: auto;
}

.script-actions-bar {
  flex-shrink: 0;
}

.script-player-bar {
  flex-shrink: 0;
}

.bg-surface-variant-subtle {
  background-color: rgba(var(--v-theme-surface-variant), 0.25);
}

.script-lines-scroll {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.script-lines-scroll,
.studio-tab-pane--scroll {
  scrollbar-gutter: stable;
}

.script-lines-scroll::-webkit-scrollbar,
.studio-tab-pane--scroll::-webkit-scrollbar {
  width: 6px;
}

.script-lines-scroll::-webkit-scrollbar-thumb,
.studio-tab-pane--scroll::-webkit-scrollbar-thumb {
  background-color: rgba(var(--v-theme-on-surface), 0.2);
  border-radius: 4px;
}

.script-lines-scroll:hover::-webkit-scrollbar-thumb,
.studio-tab-pane--scroll:hover::-webkit-scrollbar-thumb {
  background-color: rgba(var(--v-theme-on-surface), 0.45);
}

.cast-grid-scroll {
  width: 100%;
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
  background: rgba(var(--v-theme-surface-variant), 0.15);
  transition: all 0.2s ease;
  min-height: 180px;
}

.add-role-card:hover {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.05);
}

.bgm-tab-container {
  max-width: 820px;
  margin: 0 auto;
  width: 100%;
  overflow-y: auto;
}

.cursor-pointer {
  cursor: pointer;
}
</style>
