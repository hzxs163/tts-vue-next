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
  rate: number;
  pitch: number;
  volume: number;
  color: string;
  isDefault?: boolean;
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

export interface TtsSubtitlesEvent {
  taskId: string;
  srt: string;
  vtt: string;
  cues: SubtitleCue[];
}

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
