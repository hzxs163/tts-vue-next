<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useMessage } from "vuetify-message-vue3";
import { useDictionaryStore } from "../stores/dictionary";
import type { DictionaryCategory, DictionaryRule } from "../types";

const { t } = useI18n();
const message = useMessage();
const dictionaryStore = useDictionaryStore();

const searchQuery = ref("");
const selectedCategory = ref<"all" | DictionaryCategory>("all");
const testInput = ref("重新启动银行系统，拨打110联系Vue团队");

const testOutput = computed(() => {
  return dictionaryStore.applyDictionary(testInput.value);
});

const filteredRules = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  const category = selectedCategory.value;

  return dictionaryStore.rules.filter((rule) => {
    const matchCategory = category === "all" || rule.category === category;
    if (!matchCategory) {
      return false;
    }
    if (!query) {
      return true;
    }
    const originMatch = rule.origin.toLowerCase().includes(query);
    const replacementMatch = rule.replacement.toLowerCase().includes(query);
    const descMatch = (rule.description || "").toLowerCase().includes(query);
    return originMatch || replacementMatch || descMatch;
  });
});

const categoryOptions = computed(() => [
  { title: t("dictionary.categories.polyphone"), value: "polyphone" },
  { title: t("dictionary.categories.number"), value: "number" },
  { title: t("dictionary.categories.custom"), value: "custom" },
]);

// Dialog state
const dialogOpen = ref(false);
const editingRuleId = ref<string | null>(null);
const formOrigin = ref("");
const formReplacement = ref("");
const formCategory = ref<DictionaryCategory>("custom");
const formIsRegex = ref(false);
const formMatchCase = ref(false);
const formDescription = ref("");

function openAddDialog() {
  editingRuleId.value = null;
  formOrigin.value = "";
  formReplacement.value = "";
  formCategory.value = "custom";
  formIsRegex.value = false;
  formMatchCase.value = false;
  formDescription.value = "";
  dialogOpen.value = true;
}

function openEditDialog(rule: DictionaryRule) {
  editingRuleId.value = rule.id;
  formOrigin.value = rule.origin;
  formReplacement.value = rule.replacement;
  formCategory.value = rule.category || "custom";
  formIsRegex.value = Boolean(rule.isRegex);
  formMatchCase.value = Boolean(rule.matchCase);
  formDescription.value = rule.description || "";
  dialogOpen.value = true;
}

function saveRule() {
  const origin = formOrigin.value.trim();
  const replacement = formReplacement.value.trim();

  if (!origin) {
    message.error(t("dictionary.dialog.originRequired"));
    return;
  }
  if (!replacement) {
    message.error(t("dictionary.dialog.replacementRequired"));
    return;
  }

  if (editingRuleId.value) {
    dictionaryStore.updateRule(editingRuleId.value, {
      origin,
      replacement,
      category: formCategory.value,
      isRegex: formIsRegex.value,
      matchCase: formMatchCase.value,
      description: formDescription.value.trim() || undefined,
    });
  } else {
    dictionaryStore.addRule({
      origin,
      replacement,
      category: formCategory.value,
      isRegex: formIsRegex.value,
      matchCase: formMatchCase.value,
      enabled: true,
      description: formDescription.value.trim() || undefined,
    });
  }

  dialogOpen.value = false;
  message.success(t("dictionary.notifications.saved"));
}

function deleteRule(id: string) {
  dictionaryStore.deleteRule(id);
  message.success(t("dictionary.notifications.deleted"));
}

function handleResetDefaults() {
  if (window.confirm(t("dictionary.actions.resetConfirm"))) {
    dictionaryStore.resetToDefaults();
    message.success(t("dictionary.notifications.resetSuccess"));
  }
}

function exportRulesToFile() {
  try {
    const jsonStr = dictionaryStore.exportRules();
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tts-dictionary-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    message.success(t("dictionary.notifications.exported"));
  } catch (error) {
    message.error(String(error));
  }
}

const fileInputRef = ref<HTMLInputElement | null>(null);

function triggerImport() {
  fileInputRef.value?.click();
}

function handleFileImport(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const content = e.target?.result as string;
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        dictionaryStore.importRules(parsed, false);
        message.success(t("dictionary.notifications.imported", { count: parsed.length }));
      } else {
        message.error(t("dictionary.notifications.importFailed"));
      }
    } catch {
      message.error(t("dictionary.notifications.importFailed"));
    } finally {
      if (target) {
        target.value = "";
      }
    }
  };
  reader.readAsText(file);
}
</script>

<template>
  <v-container fluid class="dictionary-page">
    <section class="dictionary-workspace">
      <v-card flat class="dictionary-panel glass-panel">
        <v-card-item>
          <template #prepend>
            <v-avatar color="primary" variant="tonal" size="36">
              <v-icon>mdi-translate</v-icon>
            </v-avatar>
          </template>
          <div class="text-overline text-medium-emphasis">{{ $t("dictionary.hero.overline") }}</div>
          <v-card-title class="text-h6">{{ $t("dictionary.hero.title") }}</v-card-title>
          <v-card-subtitle>{{ $t("dictionary.hero.description") }}</v-card-subtitle>

          <template #append>
            <div class="d-flex align-center ga-3">
              <v-switch
                :model-value="dictionaryStore.enabled"
                :label="$t('dictionary.actions.enableDictionary')"
                color="primary"
                hide-details
                density="compact"
                @update:model-value="(val) => dictionaryStore.setEnabled(Boolean(val))"
              />
              <v-btn color="primary" variant="flat" prepend-icon="mdi-plus" @click="openAddDialog">
                {{ $t("dictionary.actions.addRule") }}
              </v-btn>
              <v-btn variant="tonal" prepend-icon="mdi-folder-open-outline" @click="triggerImport">
                {{ $t("dictionary.actions.import") }}
              </v-btn>
              <v-btn variant="tonal" prepend-icon="mdi-content-save" @click="exportRulesToFile">
                {{ $t("dictionary.actions.export") }}
              </v-btn>
              <v-btn
                variant="text"
                color="error"
                prepend-icon="mdi-refresh"
                @click="handleResetDefaults"
              >
                {{ $t("dictionary.actions.reset") }}
              </v-btn>
              <input
                ref="fileInputRef"
                type="file"
                accept=".json"
                style="display: none"
                @change="handleFileImport"
              />
            </div>
          </template>
        </v-card-item>

        <v-divider />

        <v-card-text class="dictionary-content">
          <!-- Live Preview Card -->
          <v-card variant="outlined" class="tester-card mb-4">
            <v-card-item class="pb-1">
              <div class="d-flex align-center ga-2">
                <v-icon color="primary" size="20">mdi-cached</v-icon>
                <span class="text-subtitle-2 font-weight-bold">{{
                  $t("dictionary.tester.title")
                }}</span>
              </div>
            </v-card-item>
            <v-card-text class="pt-2">
              <div class="tester-grid">
                <v-textarea
                  v-model="testInput"
                  :label="$t('dictionary.tester.inputLabel')"
                  :placeholder="$t('dictionary.tester.inputPlaceholder')"
                  rows="2"
                  auto-grow
                  variant="outlined"
                  density="compact"
                  hide-details
                />
                <v-textarea
                  :model-value="testOutput"
                  :label="$t('dictionary.tester.outputLabel')"
                  :placeholder="$t('dictionary.tester.outputPlaceholder')"
                  rows="2"
                  auto-grow
                  readonly
                  variant="outlined"
                  density="compact"
                  color="primary"
                  hide-details
                />
              </div>
            </v-card-text>
          </v-card>

          <!-- Search and Filters -->
          <div class="d-flex align-center justify-space-between flex-wrap ga-3 mb-3">
            <v-text-field
              v-model="searchQuery"
              :placeholder="$t('dictionary.table.searchPlaceholder')"
              prepend-inner-icon="mdi-magnify"
              variant="outlined"
              density="compact"
              hide-details
              clearable
              class="search-field"
            />
            <v-btn-toggle
              v-model="selectedCategory"
              mandatory
              density="compact"
              color="primary"
              variant="outlined"
            >
              <v-btn value="all">{{ $t("dictionary.table.filterAll") }}</v-btn>
              <v-btn value="polyphone">{{ $t("dictionary.table.filterPolyphone") }}</v-btn>
              <v-btn value="number">{{ $t("dictionary.table.filterNumber") }}</v-btn>
              <v-btn value="custom">{{ $t("dictionary.table.filterCustom") }}</v-btn>
            </v-btn-toggle>
          </div>

          <!-- Rules List Table -->
          <div class="rules-table-container">
            <v-table hover density="comfortable" class="rules-table">
              <thead>
                <tr>
                  <th style="width: 70px">{{ $t("dictionary.table.status") }}</th>
                  <th>{{ $t("dictionary.table.origin") }}</th>
                  <th style="width: 30px"></th>
                  <th>{{ $t("dictionary.table.replacement") }}</th>
                  <th>{{ $t("dictionary.table.category") }}</th>
                  <th>{{ $t("dictionary.table.description") }}</th>
                  <th style="width: 100px; text-align: right">
                    {{ $t("dictionary.table.actions") }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="rule in filteredRules" :key="rule.id">
                  <td>
                    <v-switch
                      :model-value="rule.enabled"
                      color="primary"
                      density="compact"
                      hide-details
                      @update:model-value="() => dictionaryStore.toggleRule(rule.id)"
                    />
                  </td>
                  <td>
                    <span class="font-weight-medium mr-2">{{ rule.origin }}</span>
                    <v-chip
                      v-if="rule.isRegex"
                      size="x-small"
                      color="secondary"
                      variant="tonal"
                      class="mr-1"
                    >
                      {{ $t("dictionary.table.regexBadge") }}
                    </v-chip>
                    <v-chip v-if="rule.matchCase" size="x-small" color="info" variant="tonal">
                      {{ $t("dictionary.table.matchCaseBadge") }}
                    </v-chip>
                  </td>
                  <td>
                    <v-icon size="16" color="medium-emphasis">mdi-arrow-right</v-icon>
                  </td>
                  <td>
                    <span class="font-weight-bold text-primary">{{ rule.replacement }}</span>
                  </td>
                  <td>
                    <v-chip
                      size="small"
                      :color="
                        rule.category === 'polyphone'
                          ? 'primary'
                          : rule.category === 'number'
                            ? 'warning'
                            : 'success'
                      "
                      variant="tonal"
                    >
                      {{
                        rule.category === "polyphone"
                          ? $t("dictionary.categories.polyphone")
                          : rule.category === "number"
                            ? $t("dictionary.categories.number")
                            : $t("dictionary.categories.custom")
                      }}
                    </v-chip>
                  </td>
                  <td class="text-medium-emphasis text-body-2">
                    {{ rule.description || "—" }}
                  </td>
                  <td style="text-align: right">
                    <v-btn
                      icon
                      variant="text"
                      size="small"
                      color="primary"
                      @click="openEditDialog(rule)"
                    >
                      <v-icon size="18">mdi-pencil</v-icon>
                    </v-btn>
                    <v-btn
                      icon
                      variant="text"
                      size="small"
                      color="error"
                      @click="deleteRule(rule.id)"
                    >
                      <v-icon size="18">mdi-delete-outline</v-icon>
                    </v-btn>
                  </td>
                </tr>

                <tr v-if="filteredRules.length === 0">
                  <td colspan="7" class="text-center py-8 text-medium-emphasis">
                    <v-icon size="36" class="mb-2">mdi-translate</v-icon>
                    <div class="text-subtitle-1">{{ $t("dictionary.table.emptyTitle") }}</div>
                    <div class="text-caption">{{ $t("dictionary.table.emptyDescription") }}</div>
                  </td>
                </tr>
              </tbody>
            </v-table>
          </div>
        </v-card-text>
      </v-card>
    </section>

    <!-- Add/Edit Rule Dialog -->
    <v-dialog v-model="dialogOpen" max-width="500px">
      <v-card class="glass-panel">
        <v-card-title class="text-h6 pa-4">
          {{ editingRuleId ? $t("dictionary.dialog.editTitle") : $t("dictionary.dialog.addTitle") }}
        </v-card-title>
        <v-divider />
        <v-card-text class="pa-4 d-flex flex-column ga-3">
          <v-text-field
            v-model="formOrigin"
            :label="$t('dictionary.dialog.origin')"
            :placeholder="$t('dictionary.dialog.originPlaceholder')"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
          />
          <v-text-field
            v-model="formReplacement"
            :label="$t('dictionary.dialog.replacement')"
            :placeholder="$t('dictionary.dialog.replacementPlaceholder')"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
          />
          <v-select
            v-model="formCategory"
            :items="categoryOptions"
            :label="$t('dictionary.dialog.category')"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
          />
          <v-text-field
            v-model="formDescription"
            :label="$t('dictionary.dialog.description')"
            :placeholder="$t('dictionary.dialog.descriptionPlaceholder')"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
          />
          <div class="d-flex ga-4">
            <v-switch
              v-model="formIsRegex"
              :label="$t('dictionary.dialog.isRegex')"
              color="primary"
              density="compact"
              hide-details
            />
            <v-switch
              v-model="formMatchCase"
              :label="$t('dictionary.dialog.matchCase')"
              color="primary"
              density="compact"
              hide-details
            />
          </div>
        </v-card-text>
        <v-divider />
        <v-card-actions class="pa-4 justify-end ga-2">
          <v-btn variant="text" @click="dialogOpen = false">{{
            $t("dictionary.dialog.cancel")
          }}</v-btn>
          <v-btn color="primary" variant="flat" @click="saveRule">{{
            $t("dictionary.dialog.save")
          }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.dictionary-page {
  padding: 12px;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.dictionary-workspace {
  flex: 1;
  display: flex;
  min-height: 0;
}

.dictionary-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-radius: 24px;
}

.dictionary-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  padding: 16px;
}

.tester-card {
  border-radius: 16px;
  background: rgba(var(--v-theme-surface), 0.5);
}

.tester-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

@media (max-width: 768px) {
  .tester-grid {
    grid-template-columns: 1fr;
  }
}

.search-field {
  max-width: 320px;
}

.rules-table-container {
  flex: 1;
  overflow-y: auto;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 16px;
  background: rgba(var(--v-theme-surface), 0.6);
}

.rules-table {
  background: transparent !important;
}
</style>
