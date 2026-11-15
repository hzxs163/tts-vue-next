import { describe, expect, test } from "vitest";
import { bytesToBase64 } from "./bytes";

describe("bytesToBase64", () => {
  test("encodes a small byte array", () => {
    expect(bytesToBase64(new Uint8Array([1, 2, 3]))).toBe("AQID");
  });

  test("returns an empty string for empty input", () => {
    expect(bytesToBase64(new Uint8Array())).toBe("");
  });

  test("handles payloads larger than one encoding chunk", () => {
    const bytes = new Uint8Array(70_000).fill(65);
    const encoded = bytesToBase64(bytes);

    expect(encoded.length).toBe(Math.ceil(70_000 / 3) * 4);
    expect(atob(encoded).length).toBe(70_000);
  });
});
