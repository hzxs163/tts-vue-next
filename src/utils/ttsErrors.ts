export type TtsErrorKind =
  | "auth"
  | "network"
  | "timeout"
  | "cancelled"
  | "unknown";

/** Map a Tauri/IPC error to a stable, user-facing error category. */
export function classifyTtsError(error: unknown): TtsErrorKind {
  const message = (
    error instanceof Error ? error.message : String(error ?? "")
  ).toLowerCase();

  if (message.includes("cancel")) {
    return "cancelled";
  }
  if (
    message.includes("403") ||
    message.includes("forbidden") ||
    message.includes("unauthor")
  ) {
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

export function classifyServiceError(
  code: string,
  message: string,
): TtsErrorKind {
  if (code === "auth" || code === "network" || code === "timeout") {
    return code;
  }

  return classifyTtsError(message);
}

export function ttsErrorKey(kind: TtsErrorKind): string {
  return `errors.${kind}`;
}
