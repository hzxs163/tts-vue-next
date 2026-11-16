import { describe, expect, test } from "vitest";
import {
  classifyServiceError,
  classifyTtsError,
  isRetryableTtsError,
  toErrorMessage,
  ttsErrorKey,
} from "./ttsErrors";

describe("ttsErrors", () => {
  test("prefers structured codes over message parsing", () => {
    expect(classifyTtsError({ code: "auth", message: "nope", retryable: false })).toBe("auth");
    expect(classifyTtsError({ code: "cancelled", message: "stop" })).toBe("cancelled");
    expect(classifyTtsError({ code: "unknown", message: "HTTP error: status 403" })).toBe(
      "unknown",
    );
  });

  test("extracts messages from structured and plain errors", () => {
    expect(toErrorMessage({ code: "network", message: "boom" })).toBe("boom");
    expect(toErrorMessage(new Error("plain"))).toBe("plain");
    expect(toErrorMessage("raw")).toBe("raw");
    expect(isRetryableTtsError({ retryable: false })).toBe(false);
    expect(isRetryableTtsError(new Error("plain"))).toBeUndefined();
  });
  test("classifies Microsoft auth rejections", () => {
    expect(classifyTtsError(new Error("HTTP error: status 403"))).toBe("auth");
    expect(classifyTtsError("Forbidden")).toBe("auth");
  });

  test("classifies network and timeout failures", () => {
    expect(classifyTtsError(new Error("Connection timeout"))).toBe("timeout");
    expect(classifyTtsError("WebSocket error: closed")).toBe("network");
    expect(classifyTtsError("reqwest error")).toBe("unknown");
  });

  test("classifies cancellation and unknown errors", () => {
    expect(classifyTtsError("Cancelled")).toBe("cancelled");
    expect(classifyTtsError("something odd")).toBe("unknown");
  });

  test("maps service probe codes and falls back to message", () => {
    expect(classifyServiceError("auth", "")).toBe("auth");
    expect(classifyServiceError("timeout", "")).toBe("timeout");
    expect(classifyServiceError("network", "")).toBe("network");
    expect(classifyServiceError("other", "HTTP error: status 403")).toBe("auth");
  });

  test("builds i18n keys", () => {
    expect(ttsErrorKey("auth")).toBe("errors.auth");
  });
});
