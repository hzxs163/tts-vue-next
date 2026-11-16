export type TtsErrorKind = "auth" | "network" | "timeout" | "cancelled" | "unknown";

/** Serializable error payload returned by Rust `CommandError`. */
export interface TtsCommandError {
  code?: string;
  message?: string;
  retryable?: boolean;
}

const ERROR_KINDS: readonly TtsErrorKind[] = ["auth", "network", "timeout", "cancelled", "unknown"];

function asCommandError(error: unknown): TtsCommandError | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const candidate = error as Record<string, unknown>;
  const code = typeof candidate.code === "string" ? candidate.code : undefined;
  const message = typeof candidate.message === "string" ? candidate.message : undefined;
  const retryable = typeof candidate.retryable === "boolean" ? candidate.retryable : undefined;
  if (!code && message === undefined && retryable === undefined) {
    return null;
  }

  return { code, message, retryable };
}

function isTtsErrorKind(value: string): value is TtsErrorKind {
  return (ERROR_KINDS as readonly string[]).includes(value);
}

/** Extract a human-readable message from a string, `Error` or command error. */
export function toErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }

  const payload = asCommandError(error);
  if (payload) {
    return payload.message ?? payload.code ?? "";
  }

  return String(error ?? "");
}

/** `retryable` from a structured backend error, when available. */
export function isRetryableTtsError(error: unknown): boolean | undefined {
  return asCommandError(error)?.retryable;
}

/** Map a Tauri/IPC error to a stable, user-facing error category. */
export function classifyTtsError(error: unknown): TtsErrorKind {
  const payload = asCommandError(error);
  if (payload?.code && isTtsErrorKind(payload.code)) {
    return payload.code;
  }

  // Fallback for older backends and plain-string errors.
  const message = (payload?.message ?? toErrorMessage(error)).toLowerCase();

  if (message.includes("cancel")) {
    return "cancelled";
  }
  if (message.includes("403") || message.includes("forbidden") || message.includes("unauthor")) {
    return "auth";
  }
  if (message.includes("timeout") || message.includes("timed out")) {
    return "timeout";
  }
  if (
    message.includes("network") ||
    message.includes("connect") ||
    message.includes("websocket") ||
    message.includes("dns") ||
    message.includes("tls") ||
    message.includes("http error") ||
    message.includes("request error")
  ) {
    return "network";
  }

  return "unknown";
}

export function classifyServiceError(code: string, message: string): TtsErrorKind {
  if (code === "auth" || code === "network" || code === "timeout") {
    return code;
  }

  return classifyTtsError(message);
}

export function ttsErrorKey(kind: TtsErrorKind): string {
  return `errors.${kind}`;
}
