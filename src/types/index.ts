export interface Voice {
  Name: string;
  ShortName: string;
  Gender: string;
  Locale: string;
  SuggestedCodec: string;
  FriendlyName: string;
  Status: string;
  VoiceTag: {
    ContentCategories: string[];
    VoicePersonalities: string[];
  };
}

export type TtsProviderId = "edge" | "azure";

/** Credentials of a paid Azure Speech resource. */
export interface AzureCredentials {
  key: string;
  region: string;
}

export interface TtsParams {
  text: string;
  voice: string;
  rate: string;
  pitch: string;
  volume: string;
  format: string;
  task_id: string;
  max_retries: number;
  chunk_concurrency: number;
  /** Defaults to the free Edge endpoint when omitted. */
  provider?: TtsProviderId;
  /** Required when `provider` is `azure`. */
  azure?: AzureCredentials | null;
}

export interface BatchFile {
  id: string;
  name: string;
  path: string;
  size: number;
  status: "pending" | "processing" | "done" | "error" | "skipped";
  progress: number;
  error?: string;
  outputPath?: string;
  content?: string;
  chapterIndex?: number;
}

export interface NovelChapter {
  id: string;
  index: number;
  title: string;
  /**
   * Title before the zero-padding was applied. It stays stable when only the
   * padding options change, which makes it a reliable key for remembering the
   * user's chapter selection across re-splits.
   */
  rawTitle?: string;
  content: string;
  charCount: number;
  selected: boolean;
}

export interface ChapterSplitPreset {
  id: string;
  name: string;
  pattern: string;
}

export interface SplitNovelOptions {
  presetId?: string;
  customPattern?: string;
  cleanAds?: boolean;
  customAdPatterns?: string[];
  padChapterIndex?: boolean;
  minChapterLength?: number;
  discardEmptyPrologue?: boolean;
  fallbackChunkSize?: number;
  /** Title of the source novel, shown alongside the split result. */
  novelTitle?: string;
}

export interface SplitNovelResult {
  chapters: NovelChapter[];
  totalChars: number;
  totalChapters: number;
  adLinesRemoved: number;
  novelTitle: string;
}

export interface DialogueRole {
  id: string;
  name: string;
  voice: string;
  /**
   * Language of `voice`. Stored on the role so the cast can show it without
   * depending on the voice catalog having been loaded, and so a character
   * keeps its language when the catalog later changes.
   */
  locale?: string;
  rate: number;
  pitch: number;
  volume: number;
  color: string;
  isDefault?: boolean;
  /** Which speech service synthesizes this role. Defaults to Edge. */
  provider?: TtsProviderId;
}

export interface DialogueLine {
  id: string;
  roleId: string;
  text: string;
  pauseAfterMs?: number;
}

export interface DialogueCastPreset {
  id: string;
  name: string;
  description: string;
  roles: DialogueRole[];
}

export interface ParseScriptOptions {
  mode?: "prefix" | "quotes";
  defaultRoleId?: string;
  pauseMs?: number;
}

export interface SubtitleCue {
  offset: number;
  duration: number;
  startMs: number;
  endMs: number;
  text: string;
}

export type DictionaryCategory = "polyphone" | "number" | "custom";

export interface DictionaryRule {
  id: string;
  origin: string;
  replacement: string;
  isRegex?: boolean;
  matchCase?: boolean;
  enabled: boolean;
  category?: DictionaryCategory;
  description?: string;
}

export interface SubtitleTrack {
  cues: SubtitleCue[];
  srt: string;
  vtt: string;
}

/**
 * Subtitle track as returned by the `tts_get_subtitles` command.
 * The track is produced by `tts_convert` and fetched afterwards, so the
 * frontend never depends on the arrival order of an event and a command
 * response.
 */
export type SubtitlePayload = SubtitleTrack | null;

export interface TtsSettings {
  savePath: string;
  outputFormat: OutputFormat;
  fileNamePattern: FileNamePattern;
  maxRetries: number;
  fileConcurrency: number;
  chunkConcurrency: number;
  conflictStrategy: ConflictStrategy;
  autoplay: boolean;
  exportSubtitles: boolean;
  language: AppLanguage;
  themeMode: ThemeMode;
  /**
   * Azure Speech resource used by roles that opt into it.
   *
   * The key is kept in the settings file in plain text: this app must run on
   * Windows, macOS and Linux, and the OS credential stores need extra native
   * dependencies that are not always present. Reads and writes go through the
   * settings store so the storage can be swapped later without touching
   * callers.
   */
  azureKey: string;
  azureRegion: string;
  azureEnabled: boolean;
}

export interface TtsProgressEvent {
  taskId: string;
  completed: number;
  total: number;
}

export interface ServiceStatus {
  ok: boolean;
  code: "ok" | "auth" | "network" | "timeout";
  endpoint: string;
  message: string;
}

export type OutputFormat = "mp3" | "wav" | "ogg" | "flac";
export type FileNamePattern = "content" | "timestamp" | "content_timestamp" | "default";
export type ConflictStrategy = "overwrite" | "skip" | "rename";
export type AppLanguage = "zh-CN" | "en-US";
export type ThemeMode = "system" | "light" | "dark";

export type DuckingStrength = "gentle" | "medium" | "strong";

export interface DuckingPreset {
  ratio: number;
  threshold: number;
}

export interface BgmSettings {
  enabled: boolean;
  bgmPath: string;
  bgmName: string;
  bgmVolume: number;
  enableDucking: boolean;
  duckingStrength: DuckingStrength;
  duckingRatio: number;
  duckingThreshold: number;
  fadeOutSec: number;
}

export interface BgmMixParams {
  vocal_path: string;
  bgm_path: string;
  output_path: string;
  bgm_volume: number;
  enable_ducking: boolean;
  ducking_ratio: number;
  ducking_threshold: number;
  fade_out_sec: number;
  format: string;
}
