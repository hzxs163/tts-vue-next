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
import { saveAudioBytes } from "../utils/saveAudio";

const dialogueStore = useDialogueStore();
const voicesStore = useVoicesStore();
const settingsStore = useSettingsStore();
const message = useMessage();

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

    const { cleanupError } = await saveAudioBytes(dialogueStore.audioBytes, filePath, ext);
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
  <v-container fluid class="dialogue-page pa-4">
    <!-- Header Hero -->
    <v-card variant="outlined" class="hero-card mb-4" rounded="xl">
      <div class="d-flex flex-wrap align-center justify-space-between ga-4 pa-4">
        <div class="d-flex align-center ga-3">
          <v-avatar color="primary" variant="tonal" size="48">
            <v-icon size="28">mdi-account-voice</v-icon>
          </v-avatar>
          <div>
            <div class="text-overline text-primary font-weight-bold">
              {{ $t("dialogue.hero.overline") }}
            </div>
            <div class="text-h6 font-weight-bold">
              {{ $t("dialogue.hero.title") }}
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
        height="4"
      />
      <div
        v-if="dialogueStore.synthesizing"
        class="px-4 py-2 bg-primary-subtle text-caption d-flex align-center justify-space-between"
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

    <!-- Layout: Cast (Left/Top) + Script Lines (Main) -->
    <v-row>
      <!-- Cast Management (Left) -->
      <v-col cols="12" md="4" lg="3">
        <v-card variant="outlined" class="cast-card glass-panel h-100" rounded="xl">
          <v-card-item class="pb-2">
            <template #prepend>
              <v-avatar color="primary" variant="tonal" size="32">
                <v-icon size="18">mdi-account-group-outline</v-icon>
              </v-avatar>
            </template>
            <v-card-title class="text-subtitle-1 font-weight-bold">
              {{ $t("dialogue.cast.title") }}
            </v-card-title>
            <template #append>
              <v-btn
                icon="mdi-plus"
                variant="tonal"
                color="primary"
                size="x-small"
                @click="openAddRoleDialog"
              />
            </template>
          </v-card-item>

          <v-divider />

          <div class="cast-list pa-3">
            <v-card
              v-for="role in dialogueStore.roles"
              :key="role.id"
              variant="outlined"
              class="role-item mb-2"
              rounded="lg"
            >
              <div class="d-flex align-center justify-space-between pa-2">
                <div class="d-flex align-center ga-2 min-w-0">
                  <v-avatar
                    :color="role.color"
                    size="30"
                    class="text-white text-caption font-weight-bold"
                  >
                    {{ role.name.slice(0, 1) }}
                  </v-avatar>
                  <div class="min-w-0">
                    <div class="d-flex align-center ga-1">
                      <span class="text-body-2 font-weight-bold text-truncate">
                        {{ role.name }}
                      </span>
                      <v-chip
                        v-if="role.isDefault"
                        size="x-small"
                        color="primary"
                        variant="flat"
                        class="px-1"
                      >
                        {{ $t("dialogue.cast.defaultBadge") }}
                      </v-chip>
                    </div>
                    <div
                      class="text-caption text-medium-emphasis text-truncate"
                      style="max-width: 150px"
                    >
                      {{ role.voice.replace("Neural", "").split("-").pop() }}
                    </div>
                  </div>
                </div>

                <div class="d-flex align-center ga-1">
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
                </div>
              </div>
            </v-card>
          </div>
        </v-card>
      </v-col>

      <!-- Script Workspace (Right/Main) -->
      <v-col cols="12" md="8" lg="9">
        <v-card variant="outlined" class="script-card glass-panel" rounded="xl">
          <v-card-item class="pb-2">
            <template #prepend>
              <v-avatar color="primary" variant="tonal" size="32">
                <v-icon size="18">mdi-script-text-outline</v-icon>
              </v-avatar>
            </template>
            <v-card-title class="text-subtitle-1 font-weight-bold">
              {{ $t("dialogue.script.title") }}
            </v-card-title>
            <v-card-subtitle class="text-caption">
              {{
                $t("dialogue.script.lineCount", {
                  lines: dialogueStore.lines.length,
                  chars: totalChars,
                })
              }}
            </v-card-subtitle>
            <template #append>
              <v-btn
                variant="tonal"
                color="primary"
                size="small"
                prepend-icon="mdi-plus"
                @click="dialogueStore.addLine()"
              >
                {{ $t("dialogue.script.addLine") }}
              </v-btn>
            </template>
          </v-card-item>

          <v-divider />

          <!-- Script Lines List -->
          <div class="script-lines-container pa-3">
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
                          class="px-2"
                        >
                          <v-icon start size="14">mdi-account</v-icon>
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
                        />
                      </v-list>
                    </v-menu>

                    <v-chip size="x-small" variant="outlined" class="text-caption">
                      {{
                        $t("dialogue.script.pauseAfter", {
                          ms: line.pauseAfterMs || dialogueStore.defaultPauseMs,
                        })
                      }}
                    </v-chip>
                  </div>

                  <!-- Actions -->
                  <div class="d-flex align-center ga-1">
                    <v-btn
                      icon
                      size="x-small"
                      variant="text"
                      color="primary"
                      :loading="dialogueStore.auditioningLineId === line.id"
                      @click="dialogueStore.auditionLine(line.id)"
                    >
                      <v-icon size="16">mdi-play</v-icon>
                    </v-btn>
                    <v-btn
                      icon="mdi-plus"
                      size="x-small"
                      variant="text"
                      @click="dialogueStore.insertLineAfter(index, line.roleId)"
                    />
                    <v-btn
                      icon="mdi-close"
                      size="x-small"
                      variant="text"
                      color="error"
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
              <div class="text-caption">
                {{ $t("dialogue.script.emptyDescription") }}
              </div>
            </div>
          </div>

          <!-- Bottom Audio Player & Export Bar (shown when audio is generated) -->
          <v-divider v-if="dialogueStore.audioUrl" />
          <div
            v-if="dialogueStore.audioUrl"
            class="pa-4 bg-surface d-flex flex-wrap align-center justify-space-between ga-3"
          >
            <audio :src="dialogueStore.audioUrl" controls style="flex: 1; min-width: 280px" />
            <div class="d-flex align-center ga-2">
              <v-btn
                color="primary"
                variant="tonal"
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
        </v-card>
      </v-col>
    </v-row>

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
  overflow-y: auto;
}

.hero-card,
.cast-card,
.script-card {
  background: rgba(var(--v-theme-surface), 0.95);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.cast-list {
  max-height: 520px;
  overflow-y: auto;
}

.role-item {
  border: 1px solid rgba(var(--v-border-color), 0.5);
  background: rgba(var(--v-theme-surface), 0.6);
}

.script-lines-container {
  max-height: 560px;
  overflow-y: auto;
}

.dialogue-line-card {
  background: rgba(var(--v-theme-surface), 0.8);
  border: 1px solid rgba(var(--v-border-color), 0.4);
  transition: all 0.2s ease;
}

.dialogue-line-card:hover {
  background: rgba(var(--v-theme-surface), 0.98);
  box-shadow: 0 4px 12px rgba(var(--v-theme-on-surface), 0.05);
}
</style>
