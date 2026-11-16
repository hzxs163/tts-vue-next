<script setup lang="ts">
import { computed, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useI18n } from "vue-i18n";
import { useMessage } from "vuetify-message-vue3";
import { useBatchStore } from "../../stores/batch";
import NovelSplitDialog from "./NovelSplitDialog.vue";

const SUPPORTED_EXTENSIONS = new Set(["txt", "md", "markdown", "docx"]);

const batchStore = useBatchStore();
const message = useMessage();
const { t } = useI18n();
const fileError = ref<string | null>(null);

// Novel split dialog state
const showNovelDialog = ref(false);
const novelFilePath = ref("");
const novelFileName = ref("");
const novelFileSize = ref("");
const novelRawContent = ref("");

const isDisabled = computed(() => batchStore.converting);

function isSupportedPath(path: string): boolean {
  const extension = path.split(".").pop()?.toLowerCase();
  return extension ? SUPPORTED_EXTENSIONS.has(extension) : false;
}

function filterSupportedPaths(paths: string[]): string[] {
  return paths.filter(isSupportedPath);
}

function setUnsupportedFilesError(paths: string[]) {
  const unsupportedPaths = paths.filter((path) => !isSupportedPath(path));
  fileError.value =
    unsupportedPaths.length > 0
      ? t("batch.upload.unsupportedFileTypes", {
          files: unsupportedPaths.map((path) => path.split(/[\\/]/).pop() || path).join(", "),
        })
      : null;

  if (fileError.value) {
    message.error(fileError.value);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function openFilePicker() {
  if (isDisabled.value) {
    return;
  }

  try {
    fileError.value = null;
    const files = await open({
      multiple: true,
      filters: [
        {
          name: t("batch.upload.filePickerFilterName"),
          extensions: ["txt", "md", "markdown", "docx"],
        },
      ],
    });

    if (!files || isDisabled.value) {
      return;
    }

    const paths = Array.isArray(files) ? files.map(String) : [String(files)];
    const supportedPaths = filterSupportedPaths(paths);
    setUnsupportedFilesError(paths);
    if (supportedPaths.length > 0) {
      batchStore.addFiles(supportedPaths);
    }
  } catch (error) {
    fileError.value = error instanceof Error ? error.message : String(error);
    message.error(fileError.value);
  }
}

async function openNovelPicker() {
  if (isDisabled.value) {
    return;
  }

  try {
    fileError.value = null;
    const file = await open({
      multiple: false,
      filters: [
        {
          name: t("batch.upload.novelPickerFilterName"),
          extensions: ["txt", "md", "markdown", "docx"],
        },
      ],
    });

    if (!file || isDisabled.value) {
      return;
    }

    const path = String(file);
    if (!isSupportedPath(path)) {
      message.error(
        t("batch.upload.unsupportedFileTypes", {
          files: path.split(/[\\/]/).pop() || path,
        }),
      );
      return;
    }

    const content = await invoke<string>("read_text_file", { path });
    const fileName = path.split(/[\\/]/).pop() || path;
    const sizeBytes = new Blob([content]).size;

    novelFilePath.value = path;
    novelFileName.value = fileName;
    novelFileSize.value = formatBytes(sizeBytes);
    novelRawContent.value = content;
    showNovelDialog.value = true;
  } catch (error) {
    fileError.value = error instanceof Error ? error.message : String(error);
    message.error(fileError.value);
  }
}
</script>

<template>
  <div class="d-inline-flex align-center ga-2">
    <v-btn
      color="primary"
      variant="tonal"
      prepend-icon="mdi-folder-open-outline"
      :disabled="isDisabled"
      @click="openFilePicker"
    >
      {{ $t("batch.upload.chooseFiles") }}
    </v-btn>

    <v-btn
      color="secondary"
      variant="tonal"
      prepend-icon="mdi-book-open-page-variant-outline"
      :disabled="isDisabled"
      @click="openNovelPicker"
    >
      {{ $t("batch.upload.importNovel") }}
    </v-btn>

    <NovelSplitDialog
      v-model="showNovelDialog"
      :file-path="novelFilePath"
      :file-name="novelFileName"
      :file-size="novelFileSize"
      :raw-content="novelRawContent"
    />
  </div>
</template>
