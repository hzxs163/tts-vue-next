<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "vue-i18n";
import { useMessage } from "vuetify-message-vue3";
import { useSettingsStore } from "../../stores/settings";
import { useTtsStore } from "../../stores/tts";
import { useBgmStore } from "../../stores/bgm";
import { buildDefaultFileName } from "../../utils/fileName";
import { saveAudioBytes } from "../../utils/saveAudio";
import { toErrorMessage } from "../../utils/ttsErrors";

const ttsStore = useTtsStore();
const settingsStore = useSettingsStore();
const bgmStore = useBgmStore();
const message = useMessage();
const { t } = useI18n();

const audioRef = ref<HTMLAudioElement | null>(null);
const isPlaying = ref(false);
const currentTime = ref(0);
const duration = ref(0);
const playerVolume = ref(100);

const activeSubtitle = computed(() => {
  if (!ttsStore.subtitles || ttsStore.subtitles.cues.length === 0) {
    return "";
  }
  const currentMs = currentTime.value * 1000;
  const activeCue = ttsStore.subtitles.cues.find(
    (cue) => cue.startMs <= currentMs && currentMs <= cue.endMs + 350,
  );
  return activeCue?.text || "";
});

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "00:00";
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
}

async function togglePlay() {
  if (!audioRef.value || !ttsStore.audioUrl) {
    return;
  }

  if (isPlaying.value) {
    audioRef.value.pause();
    return;
  }

  ttsStore.$patch({ error: null });

  try {
    await audioRef.value.play();
  } catch (error) {
    // The global alert layer reports ttsStore.error; do not double-toast here.
    ttsStore.$patch({ error: toErrorMessage(error) });
  }
}

function onTimeUpdate() {
  if (audioRef.value) {
    currentTime.value = audioRef.value.currentTime;
  }
}

function onLoadedMetadata() {
  if (!audioRef.value) {
    return;
  }

  duration.value = Number.isFinite(audioRef.value.duration) ? audioRef.value.duration : 0;
  audioRef.value.volume = playerVolume.value / 100;
}

function onEnded() {
  isPlaying.value = false;
  currentTime.value = 0;
}

function seek(value: number) {
  if (audioRef.value && Number.isFinite(value)) {
    audioRef.value.currentTime = value;
  }
}

function updateVolume(value: number) {
  if (!Number.isFinite(value)) {
    return;
  }

  playerVolume.value = value;
  if (audioRef.value) {
    audioRef.value.volume = value / 100;
  }
}

async function saveAudio() {
  const audioBytes = ttsStore.audioBytes;
  if (!audioBytes) {
    return;
  }

  ttsStore.$patch({ error: null });

  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const ext = settingsStore.outputFormat;
    const defaultBase = t("tts.audioPlayer.defaultFileNameBase");
    const defaultFileName = buildDefaultFileName({
      text: ttsStore.text,
      pattern: settingsStore.fileNamePattern,
      ext,
      defaultBase,
    });
    const filePath = await save({
      defaultPath: defaultFileName,
      filters: [{ name: t("tts.audioPlayer.saveFilterName"), extensions: [ext] }],
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

    const { cleanupError } = await saveAudioBytes(audioBytes, filePath, ext, bgmOptions);
    if (cleanupError) {
      throw new Error(cleanupError);
    }

    if (settingsStore.exportSubtitles && ttsStore.subtitles?.srt) {
      const srtPath = filePath.replace(/\.[^.]+$/, "") + ".srt";
      try {
        await invoke("write_text_file", { path: srtPath, content: ttsStore.subtitles.srt });
      } catch {
        // Subtitle writing is best-effort alongside audio
      }
    }

    message.success(t("tts.audioPlayer.saved", { path: filePath }));
  } catch (error) {
    // GlobalAlerts is the single error surface; avoid a duplicate toast.
    ttsStore.$patch({ error: toErrorMessage(error) });
  }
}

async function saveSubtitles() {
  const srt = ttsStore.subtitles?.srt;
  if (!srt) {
    return;
  }

  ttsStore.$patch({ error: null });

  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const defaultBase = t("tts.audioPlayer.defaultSubtitleFileNameBase");
    const defaultFileName = buildDefaultFileName({
      text: ttsStore.text,
      pattern: settingsStore.fileNamePattern,
      ext: "srt",
      defaultBase,
    });
    const filePath = await save({
      defaultPath: defaultFileName,
      filters: [{ name: "Subtitles", extensions: ["srt", "vtt"] }],
    });

    if (!filePath) {
      return;
    }

    const content = filePath.toLowerCase().endsWith(".vtt")
      ? (ttsStore.subtitles?.vtt ?? srt)
      : srt;
    await invoke("write_text_file", { path: filePath, content });
    message.success(t("tts.audioPlayer.saved", { path: filePath }));
  } catch (error) {
    ttsStore.$patch({ error: toErrorMessage(error) });
  }
}

watch(
  () => ttsStore.audioUrl,
  async (audioUrl) => {
    if (!audioRef.value) {
      return;
    }

    if (!audioUrl) {
      audioRef.value.pause();
      audioRef.value.removeAttribute("src");
      audioRef.value.load();
      isPlaying.value = false;
      currentTime.value = 0;
      duration.value = 0;
      return;
    }

    audioRef.value.src = audioUrl;
    audioRef.value.load();
    audioRef.value.volume = playerVolume.value / 100;

    if (settingsStore.autoplay) {
      ttsStore.$patch({ error: null });

      try {
        await audioRef.value.play();
      } catch (error) {
        ttsStore.$patch({ error: toErrorMessage(error) });
      }
    }
  },
);

onUnmounted(() => {
  if (audioRef.value) {
    audioRef.value.pause();
  }
});
</script>

<template>
  <v-card flat class="audio-player glass-panel">
    <audio
      ref="audioRef"
      preload="metadata"
      @timeupdate="onTimeUpdate"
      @loadedmetadata="onLoadedMetadata"
      @play="isPlaying = true"
      @pause="isPlaying = false"
      @ended="onEnded"
    />

    <div v-if="activeSubtitle" class="audio-player__subtitle-banner text-caption">
      <v-icon size="x-small" color="primary" class="mr-1">mdi-text-box-outline</v-icon>
      <span class="audio-player__subtitle-text">{{ activeSubtitle }}</span>
    </div>

    <div class="audio-player__inner">
      <div class="audio-player__label text-caption font-weight-medium">
        {{ $t("tts.audioPlayer.title") }}
      </div>

      <v-btn
        icon
        variant="text"
        :aria-label="$t('tts.audioPlayer.togglePlayback')"
        :disabled="!ttsStore.audioUrl"
        @click="togglePlay"
      >
        <v-icon>{{ isPlaying ? "mdi-pause" : "mdi-play" }}</v-icon>
      </v-btn>

      <div class="audio-player__time text-caption text-medium-emphasis">
        {{ formatTime(currentTime) }} / {{ formatTime(duration) }}
      </div>

      <v-slider
        :model-value="currentTime"
        :max="duration || 1"
        :disabled="!ttsStore.audioUrl"
        hide-details
        density="compact"
        color="primary"
        class="audio-player__progress"
        @update:model-value="seek"
      />

      <div class="audio-player__volume d-flex align-center ga-2">
        <v-icon size="small">mdi-volume-high</v-icon>
        <v-slider
          :model-value="playerVolume"
          :min="0"
          :max="100"
          hide-details
          density="compact"
          style="width: 92px"
          @update:model-value="updateVolume"
        />
      </div>

      <div class="d-flex align-center ga-1">
        <v-btn
          v-if="ttsStore.subtitles?.srt"
          icon
          variant="text"
          :aria-label="$t('tts.audioPlayer.saveSubtitles')"
          :title="$t('tts.audioPlayer.saveSubtitles')"
          @click="saveSubtitles"
        >
          <v-icon>mdi-file-document-outline</v-icon>
        </v-btn>

        <v-btn
          icon
          variant="text"
          :aria-label="$t('tts.audioPlayer.saveGeneratedAudio')"
          :disabled="!ttsStore.audioBytes"
          @click="saveAudio"
        >
          <v-icon>mdi-content-save</v-icon>
        </v-btn>
      </div>
    </div>
  </v-card>
</template>

<style scoped>
.audio-player {
  position: sticky;
  bottom: 0;
  z-index: 2;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background: rgba(var(--v-theme-surface), 0.92);
  backdrop-filter: blur(16px);
}

.audio-player__subtitle-banner {
  padding: 4px 16px;
  background: rgba(var(--v-theme-primary), 0.08);
  border-bottom: 1px solid rgba(var(--v-border-color), 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgb(var(--v-theme-primary));
  font-weight: 500;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.audio-player__inner {
  display: grid;
  grid-template-columns: auto auto auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
}

.audio-player__label {
  color: rgb(var(--v-theme-on-surface));
  white-space: nowrap;
}

.audio-player__time {
  min-width: 92px;
}

.audio-player__progress {
  min-width: 0;
}

@media (max-width: 960px) {
  .audio-player__inner {
    grid-template-columns: auto 1fr auto;
    gap: 10px;
  }

  .audio-player__time,
  .audio-player__volume,
  .audio-player__label {
    grid-column: 1 / -1;
  }
}
</style>
