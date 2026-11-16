<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMessage } from "vuetify-message-vue3";
import type { NovelChapter } from "../../types";
import { DEFAULT_CHAPTER_PRESETS, splitNovel } from "../../utils/novelSplitter";
import { useBatchStore } from "../../stores/batch";

const props = defineProps<{
  modelValue: boolean;
  filePath?: string;
  fileName?: string;
  fileSize?: string;
  rawContent?: string;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
}>();

const message = useMessage();
const batchStore = useBatchStore();

const isOpen = computed({
  get: () => props.modelValue,
  set: (val: boolean) => emit("update:modelValue", val),
});

// Config state
const selectedPresetId = ref("webNovel");
const customPattern = ref("");
const titlePrefix = ref("");
const padIndex = ref(true);
const enableAdClean = ref(true);
const discardEmptyPrologue = ref(true);
const minChapterLength = ref(10);

// Parsed chapters
const parsedChapters = ref<NovelChapter[]>([]);
const totalAdLinesRemoved = ref(0);

// Chapter full text preview drawer/dialog
const viewingChapter = ref<NovelChapter | null>(null);

const presetOptions = computed(() =>
  DEFAULT_CHAPTER_PRESETS.map((p) => ({
    title: p.name,
    value: p.id,
  })),
);

const isCustomPreset = computed(() => selectedPresetId.value === "custom");

// Default prefix from fileName without extension
watch(
  () => props.fileName,
  (name) => {
    if (name) {
      titlePrefix.value = name.replace(/\.[^.]+$/, "");
    }
  },
  { immediate: true },
);

function recomputeChapters() {
  if (!props.rawContent) {
    parsedChapters.value = [];
    totalAdLinesRemoved.value = 0;
    return;
  }

  const result = splitNovel(props.rawContent, {
    presetId: selectedPresetId.value,
    customPattern: customPattern.value,
    cleanAds: enableAdClean.value,
    padChapterIndex: padIndex.value,
    minChapterLength: Number(minChapterLength.value) || 10,
    discardEmptyPrologue: discardEmptyPrologue.value,
  });

  parsedChapters.value = result.chapters;
  totalAdLinesRemoved.value = result.adLinesRemoved;
}

watch(
  [
    () => props.rawContent,
    selectedPresetId,
    customPattern,
    padIndex,
    enableAdClean,
    discardEmptyPrologue,
    minChapterLength,
  ],
  () => {
    recomputeChapters();
  },
  { immediate: true },
);

const selectedChapters = computed(() => parsedChapters.value.filter((ch) => ch.selected));

const selectedCount = computed(() => selectedChapters.value.length);
const totalChapters = computed(() => parsedChapters.value.length);
const selectedChars = computed(() =>
  selectedChapters.value.reduce((sum, ch) => sum + ch.charCount, 0),
);

const isAllSelected = computed(
  () => totalChapters.value > 0 && selectedCount.value === totalChapters.value,
);

function selectAll() {
  parsedChapters.value.forEach((ch) => {
    ch.selected = true;
  });
}

function deselectAll() {
  parsedChapters.value.forEach((ch) => {
    ch.selected = false;
  });
}

function confirmImport() {
  if (selectedCount.value === 0) {
    return;
  }

  const path = props.filePath || "";
  const prefix = titlePrefix.value.trim();

  batchStore.addChapters(selectedChapters.value, path, prefix);
  message.success(`已成功导入 ${selectedCount.value} 个章节到批量转换列表！`);
  isOpen.value = false;
}
</script>

<template>
  <v-dialog v-model="isOpen" max-width="1050" scrollable>
    <v-card class="novel-dialog-card glass-panel" rounded="xl">
      <v-card-item class="pb-2">
        <template #prepend>
          <v-avatar color="primary" variant="tonal" size="42">
            <v-icon size="24">mdi-book-open-page-variant</v-icon>
          </v-avatar>
        </template>
        <v-card-title class="text-h6 font-weight-bold">
          {{ $t("batch.novel.dialogTitle") }}
        </v-card-title>
        <v-card-subtitle class="text-caption">
          {{
            $t("batch.novel.fileInfo", {
              name: fileName || "未知小说",
              size: fileSize || "0 B",
              chars: rawContent ? rawContent.length : 0,
            })
          }}
        </v-card-subtitle>
        <template #append>
          <v-btn icon="mdi-close" variant="text" size="small" @click="isOpen = false" />
        </template>
      </v-card-item>

      <v-divider />

      <v-card-text class="pa-4 novel-dialog__content">
        <!-- Configuration Section -->
        <div class="novel-config-grid mb-4">
          <v-select
            v-model="selectedPresetId"
            :items="presetOptions"
            :label="$t('batch.novel.presetRule')"
            density="compact"
            variant="outlined"
            prepend-inner-icon="mdi-regex"
            hide-details
          />

          <v-text-field
            v-if="isCustomPreset"
            v-model="customPattern"
            :label="$t('batch.novel.customPattern')"
            :placeholder="$t('batch.novel.customPatternPlaceholder')"
            density="compact"
            variant="outlined"
            hide-details
          />

          <v-text-field
            v-model="titlePrefix"
            :label="$t('batch.novel.titlePrefix')"
            :placeholder="$t('batch.novel.titlePrefixPlaceholder')"
            density="compact"
            variant="outlined"
            prepend-inner-icon="mdi-format-title"
            hide-details
          />

          <v-text-field
            v-model.number="minChapterLength"
            type="number"
            :label="$t('batch.novel.minChapterLength')"
            density="compact"
            variant="outlined"
            prepend-inner-icon="mdi-counter"
            hide-details
            min="5"
          />
        </div>

        <div class="d-flex flex-wrap align-center ga-4 mb-4">
          <v-checkbox
            v-model="padIndex"
            :label="$t('batch.novel.padIndex')"
            density="compact"
            color="primary"
            hide-details
          />
          <v-checkbox
            v-model="enableAdClean"
            :label="$t('batch.novel.enableAdClean')"
            density="compact"
            color="primary"
            hide-details
          />
          <v-checkbox
            v-model="discardEmptyPrologue"
            :label="$t('batch.novel.discardEmptyPrologue')"
            density="compact"
            color="primary"
            hide-details
          />
        </div>

        <v-divider class="mb-4" />

        <!-- Stats & Actions Bar -->
        <div class="d-flex align-center justify-space-between flex-wrap ga-2 mb-3">
          <div class="d-flex align-center ga-2">
            <v-chip color="primary" variant="tonal" size="small">
              {{
                $t("batch.novel.previewTitle", {
                  count: totalChapters,
                  adLines: totalAdLinesRemoved,
                })
              }}
            </v-chip>
            <v-chip color="secondary" variant="tonal" size="small">
              {{
                $t("batch.novel.selectedCount", {
                  selected: selectedCount,
                  total: totalChapters,
                  chars: selectedChars,
                })
              }}
            </v-chip>
          </div>

          <div class="d-flex align-center ga-2">
            <v-btn
              size="small"
              variant="text"
              prepend-icon="mdi-checkbox-multiple-marked-outline"
              :disabled="isAllSelected"
              @click="selectAll"
            >
              {{ $t("batch.novel.selectAll") }}
            </v-btn>
            <v-btn
              size="small"
              variant="text"
              prepend-icon="mdi-checkbox-multiple-blank-outline"
              :disabled="selectedCount === 0"
              @click="deselectAll"
            >
              {{ $t("batch.novel.deselectAll") }}
            </v-btn>
          </div>
        </div>

        <!-- Chapters Table -->
        <div class="chapter-table-wrapper">
          <v-table v-if="parsedChapters.length > 0" density="compact" fixed-header height="340px">
            <thead>
              <tr>
                <th style="width: 48px">#</th>
                <th style="width: 240px">{{ $t("batch.novel.columns.title") }}</th>
                <th style="width: 90px">{{ $t("batch.novel.columns.chars") }}</th>
                <th>{{ $t("batch.novel.columns.preview") }}</th>
                <th style="width: 80px">{{ $t("batch.list.columns.actions") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="ch in parsedChapters"
                :key="ch.id"
                :class="{ 'tr--selected': ch.selected }"
              >
                <td>
                  <v-checkbox-btn v-model="ch.selected" color="primary" density="compact" />
                </td>
                <td class="font-weight-medium text-truncate" style="max-width: 240px">
                  {{ ch.title }}
                </td>
                <td class="text-caption text-medium-emphasis">
                  {{ ch.charCount }}
                </td>
                <td
                  class="text-caption text-medium-emphasis text-truncate"
                  style="max-width: 380px"
                >
                  {{ ch.content.slice(0, 80) }}...
                </td>
                <td>
                  <v-btn
                    icon="mdi-eye-outline"
                    variant="text"
                    size="x-small"
                    @click="viewingChapter = ch"
                  />
                </td>
              </tr>
            </tbody>
          </v-table>

          <div v-else class="text-center py-8 text-medium-emphasis">
            <v-icon size="36" class="mb-2">mdi-alert-circle-outline</v-icon>
            <div class="text-body-2">
              {{ $t("batch.novel.actions.noChaptersFound") }}
            </div>
          </div>
        </div>
      </v-card-text>

      <v-divider />

      <v-card-actions class="pa-4 d-flex justify-end ga-3">
        <v-btn variant="outlined" @click="isOpen = false">
          {{ $t("batch.novel.actions.cancel") }}
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          prepend-icon="mdi-import"
          :disabled="selectedCount === 0"
          @click="confirmImport"
        >
          {{ $t("batch.novel.actions.import", { count: selectedCount }) }}
        </v-btn>
      </v-card-actions>
    </v-card>

    <!-- Full Text Inspection Subdialog -->
    <v-dialog
      :model-value="viewingChapter !== null"
      max-width="700"
      @update:model-value="viewingChapter = null"
    >
      <v-card v-if="viewingChapter" rounded="lg" class="glass-panel">
        <v-card-item>
          <v-card-title class="text-subtitle-1 font-weight-bold">
            {{ viewingChapter.title }}
          </v-card-title>
          <v-card-subtitle class="text-caption">
            {{ viewingChapter.charCount }} 字
          </v-card-subtitle>
          <template #append>
            <v-btn icon="mdi-close" variant="text" size="small" @click="viewingChapter = null" />
          </template>
        </v-card-item>
        <v-divider />
        <v-card-text style="max-height: 450px; overflow-y: auto" class="text-body-2 font-mono">
          <p style="white-space: pre-wrap; line-height: 1.8">
            {{ viewingChapter.content }}
          </p>
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-dialog>
</template>

<style scoped>
.novel-dialog-card {
  background: rgba(var(--v-theme-surface), 0.95);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.novel-config-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.chapter-table-wrapper {
  border: 1px solid rgba(var(--v-border-color), 0.5);
  border-radius: 8px;
  overflow: hidden;
}

.tr--selected {
  background: rgba(var(--v-theme-primary), 0.04);
}
</style>
