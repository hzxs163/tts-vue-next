<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useBgmStore } from "../../stores/bgm";
import type { DuckingStrength } from "../../types";

withDefaults(
  defineProps<{
    dense?: boolean;
    elevation?: number | string;
  }>(),
  {
    dense: false,
    elevation: 1,
  },
);

const bgmStore = useBgmStore();
const { t } = useI18n();

const volumePercent = computed({
  get: () => Math.round(bgmStore.bgmVolume * 100),
  set: (val: number) => {
    bgmStore.setBgmVolume(val / 100);
  },
});

const duckingRatio = computed({
  get: () => bgmStore.duckingRatio,
  set: (val: number) => {
    bgmStore.setCustomDucking(val, bgmStore.duckingThreshold);
  },
});

const duckingThreshold = computed({
  get: () => bgmStore.duckingThreshold,
  set: (val: number) => {
    bgmStore.setCustomDucking(bgmStore.duckingRatio, val);
  },
});

const duckingStrengths: Array<{ value: DuckingStrength; label: string }> = [
  { value: "gentle", label: t("bgm.strengths.gentle") },
  { value: "medium", label: t("bgm.strengths.medium") },
  { value: "strong", label: t("bgm.strengths.strong") },
];

function selectDuckingStrength(strength: DuckingStrength) {
  bgmStore.setDuckingStrength(strength);
}
</script>

<template>
  <v-card :elevation="elevation" rounded="lg" class="bgm-card border">
    <v-card-item class="bgm-card__header pb-2">
      <template #prepend>
        <v-avatar color="primary" variant="tonal" size="36" class="mr-2">
          <v-icon icon="mdi-music" size="20" />
        </v-avatar>
      </template>

      <v-card-title class="text-subtitle-1 font-weight-bold">
        {{ t("bgm.cardTitle") }}
      </v-card-title>
      <v-card-subtitle class="text-caption text-truncate">
        {{ bgmStore.hasBgmFile ? bgmStore.bgmName : t("bgm.noMusicSelected") }}
      </v-card-subtitle>

      <template #append>
        <v-switch
          v-model="bgmStore.enabled"
          color="primary"
          density="compact"
          hide-details
          inset
          @update:model-value="bgmStore.setEnabled(Boolean($event))"
        />
      </template>
    </v-card-item>

    <v-expand-transition>
      <div v-if="bgmStore.enabled" class="bgm-card__content px-4 pb-4">
        <v-divider class="my-3" />

        <!-- Music file selection -->
        <div class="mb-4">
          <div
            v-if="bgmStore.hasBgmFile"
            class="selected-file-box d-flex align-center justify-space-between rounded px-3 py-2"
          >
            <div class="d-flex align-center text-truncate mr-2">
              <v-icon icon="mdi-music-circle" color="primary" class="mr-2" />
              <span class="text-body-2 font-weight-medium text-truncate" :title="bgmStore.bgmPath">
                {{ bgmStore.bgmName }}
              </span>
            </div>
            <div class="d-flex align-center flex-shrink-0">
              <v-btn
                size="small"
                variant="text"
                color="primary"
                prepend-icon="mdi-swap-horizontal"
                class="mr-1"
                @click="bgmStore.pickBgmFile()"
              >
                {{ t("bgm.changeMusic") }}
              </v-btn>
              <v-btn
                size="small"
                variant="text"
                color="error"
                icon="mdi-close"
                @click="bgmStore.clearBgm()"
              />
            </div>
          </div>

          <v-btn
            v-else
            block
            variant="outlined"
            color="primary"
            class="dashed-pick-btn py-3"
            prepend-icon="mdi-plus"
            @click="bgmStore.pickBgmFile()"
          >
            {{ t("bgm.selectMusic") }}
          </v-btn>
        </div>

        <!-- BGM Volume slider -->
        <div class="mb-3">
          <div class="d-flex align-center justify-space-between mb-1">
            <span class="text-caption text-medium-emphasis">{{ t("bgm.volume") }}</span>
            <span class="text-caption font-weight-bold">{{ volumePercent }}%</span>
          </div>
          <v-slider
            v-model="volumePercent"
            :min="5"
            :max="100"
            :step="5"
            color="primary"
            thumb-size="14"
            track-size="4"
            prepend-icon="mdi-volume-medium"
            hide-details
            density="compact"
          />
        </div>

        <!-- Audio Ducking Switch and Strength -->
        <div class="ducking-box mt-3 pa-3 rounded-lg border">
          <div class="d-flex align-center justify-space-between mb-1">
            <div class="d-flex flex-column">
              <span class="text-body-2 font-weight-bold">{{ t("bgm.enableDucking") }}</span>
              <span class="text-caption text-medium-emphasis">{{ t("bgm.duckingDesc") }}</span>
            </div>
            <v-switch
              v-model="bgmStore.enableDucking"
              color="primary"
              density="compact"
              hide-details
              inset
              @update:model-value="bgmStore.setEnableDucking(Boolean($event))"
            />
          </div>

          <v-expand-transition>
            <div v-if="bgmStore.enableDucking" class="mt-3 pt-2 border-t">
              <div class="text-caption text-medium-emphasis mb-2">
                {{ t("bgm.duckingStrength") }}
              </div>
              <v-btn-toggle
                :model-value="bgmStore.customDucking ? 'custom' : bgmStore.duckingStrength"
                mandatory
                color="primary"
                variant="outlined"
                density="compact"
                divided
                class="w-100"
              >
                <v-btn
                  v-for="item in duckingStrengths"
                  :key="item.value"
                  :value="item.value"
                  class="flex-1-1 text-caption"
                  @click="selectDuckingStrength(item.value)"
                >
                  {{ item.label }}
                </v-btn>
                <v-btn
                  value="custom"
                  class="flex-1-1 text-caption"
                  @click="
                    bgmStore.setCustomDucking(bgmStore.duckingRatio, bgmStore.duckingThreshold)
                  "
                >
                  {{ t("bgm.customDucking") }}
                </v-btn>
              </v-btn-toggle>

              <div v-if="bgmStore.customDucking" class="mt-3">
                <div class="d-flex align-center justify-space-between mb-1">
                  <span class="text-caption text-medium-emphasis">
                    {{ t("bgm.duckingRatio") }}
                  </span>
                  <span class="text-caption font-weight-bold">
                    {{ duckingRatio.toFixed(1) }} : 1
                  </span>
                </div>
                <v-slider
                  v-model="duckingRatio"
                  :min="1.5"
                  :max="20"
                  :step="0.5"
                  color="primary"
                  thumb-size="14"
                  track-size="4"
                  hide-details
                  density="compact"
                />

                <div class="d-flex align-center justify-space-between mb-1 mt-2">
                  <span class="text-caption text-medium-emphasis">
                    {{ t("bgm.duckingThreshold") }}
                  </span>
                  <span class="text-caption font-weight-bold">
                    {{ duckingThreshold.toFixed(3) }}
                  </span>
                </div>
                <v-slider
                  v-model="duckingThreshold"
                  :min="0.01"
                  :max="0.5"
                  :step="0.01"
                  color="primary"
                  thumb-size="14"
                  track-size="4"
                  hide-details
                  density="compact"
                />
              </div>
            </div>
          </v-expand-transition>
        </div>

        <!-- Fade Out -->
        <div class="mt-3">
          <div class="d-flex align-center justify-space-between mb-1">
            <span class="text-caption text-medium-emphasis">{{ t("bgm.fadeOut") }}</span>
            <span class="text-caption font-weight-bold">{{ bgmStore.fadeOutSec }}s</span>
          </div>
          <v-slider
            :model-value="bgmStore.fadeOutSec"
            :min="0"
            :max="5"
            :step="0.5"
            color="primary"
            thumb-size="14"
            track-size="4"
            prepend-icon="mdi-fade"
            hide-details
            density="compact"
            @update:model-value="bgmStore.setFadeOutSec($event)"
          />
          <div class="text-caption text-medium-emphasis mt-1">
            {{ t("bgm.fadeOutHint") }}
          </div>
        </div>
      </div>
    </v-expand-transition>
  </v-card>
</template>

<style scoped>
.dashed-pick-btn {
  border-style: dashed !important;
  border-width: 1.5px !important;
  text-transform: none;
}
.selected-file-box {
  background-color: rgba(var(--v-theme-primary), 0.06);
  border: 1px solid rgba(var(--v-theme-primary), 0.2);
}
.ducking-box {
  background-color: rgba(var(--v-theme-primary), 0.05);
  border-color: rgba(var(--v-theme-primary), 0.18) !important;
}
</style>
