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
}

export interface TtsSettings {
  savePath: string;
  outputFormat: OutputFormat;
  maxRetries: number;
  fileConcurrency: number;
  chunkConcurrency: number;
  conflictStrategy: ConflictStrategy;
  autoplay: boolean;
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
export type ConflictStrategy = "overwrite" | "skip" | "rename";
export type AppLanguage = "zh-CN" | "en-US";
export type ThemeMode = "system" | "light" | "dark";
