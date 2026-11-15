<script setup lang="ts">
import { onMounted, onUnmounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useMessage } from "vuetify-message-vue3";
import { useBatchStore } from "../../stores/batch";
import { useTtsStore } from "../../stores/tts";
import { useVoicesStore } from "../../stores/voices";
import {
  classifyServiceError,
  classifyTtsError,
  ttsErrorKey,
  type TtsErrorKind,
} from "../../utils/ttsErrors";
import type { ServiceStatus, TtsProgressEvent } from "../../types";

const { t } = useI18n();
const message = useMessage();
const ttsStore = useTtsStore();
const batchStore = useBatchStore();
const voicesStore = useVoicesStore();
let unlistenProgress: (() => void) | undefined;

function notify(kind: TtsErrorKind, detail: string) {
  message.error(t(ttsErrorKey(kind), { message: detail }));
}

watch(
  () => ttsStore.error,
  (error) => {
    if (!error) {
      return;
    }
    notify(ttsStore.errorKind ?? classifyTtsError(error), error);
  },
);

watch(
  () => voicesStore.error,
  (error) => {
    if (!error) {
      return;
    }

    if (voicesStore.usingCache) {
      message.error(t("errors.voiceCache"));
    } else {
      notify(classifyTtsError(error), error);
    }
  },
);

onMounted(async () => {
  try {
    unlistenProgress = await listen<TtsProgressEvent>(
      "tts://progress",
      ({ payload }) => {
        ttsStore.applyProgress(payload);
        batchStore.applyProgress(payload);
      },
    );
  } catch {
    // Progress events are best-effort; conversion still works without them.
  }

  try {
    const status = await invoke<ServiceStatus>("check_tts_service");
    if (!status.ok) {
      notify(classifyServiceError(status.code, status.message), status.message);
    }
  } catch (error) {
    notify("network", String(error));
  }
});

onUnmounted(() => {
  unlistenProgress?.();
  unlistenProgress = undefined;
});
</script>

<template>
  <span class="global-alerts" aria-hidden="true" />
</template>

<style scoped>
.global-alerts {
  display: none;
}
</style>
