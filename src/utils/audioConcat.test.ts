import { describe, expect, it } from "vitest";
import { concatUint8Arrays, generateSilentMp3Bytes, msToSrtTime, msToVttTime } from "./audioConcat";

describe("audioConcat", () => {
  it("generates correct silent MP3 frame bytes", () => {
    const silent24ms = generateSilentMp3Bytes(24);
    expect(silent24ms.length).toBe(144);
    expect(silent24ms[0]).toBe(0xff);
    expect(silent24ms[1]).toBe(0xf3);
    // 0x64 => MPEG-2 Layer III, 48 kbps, 24000 Hz. Must match the Edge TTS
    // stream this silence is spliced into; 0x60 would mean 22050 Hz and a
    // non-integer 156.7-byte frame length, which breaks decoder frame sync.
    expect(silent24ms[2]).toBe(0x64);
    expect(silent24ms[3]).toBe(0xc4);
    expect(silent24ms[4]).toBe(0x00);

    const silent48ms = generateSilentMp3Bytes(48);
    expect(silent48ms.length).toBe(288);
  });

  it("keeps every generated frame aligned to the 144 byte grid", () => {
    for (const duration of [1, 23, 24, 25, 300, 1000]) {
      expect(generateSilentMp3Bytes(duration).length % 144).toBe(0);
    }
  });

  it("returns empty Uint8Array for zero or negative duration", () => {
    expect(generateSilentMp3Bytes(0).length).toBe(0);
    expect(generateSilentMp3Bytes(-10).length).toBe(0);
  });

  it("concatenates multiple Uint8Arrays correctly", () => {
    const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([3, 4, 5]);
    const combined = concatUint8Arrays([a, b]);
    expect(combined).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  it("formats SRT and VTT timestamps", () => {
    expect(msToSrtTime(3661050)).toBe("01:01:01,050");
    expect(msToVttTime(3661050)).toBe("01:01:01.050");
  });
});
