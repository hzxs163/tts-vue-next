import { describe, expect, it } from "vitest";
import { cuesToSrt, cuesToVtt, shiftCues } from "./subtitles";
import type { SubtitleCue } from "../types";

const CUES: SubtitleCue[] = [
  { offset: 0, duration: 10000000, startMs: 0, endMs: 1000, text: "第一句" },
  { offset: 10000000, duration: 5000000, startMs: 1000, endMs: 1500, text: "第二句" },
];

describe("subtitles", () => {
  it("serializes cues into an SRT document", () => {
    const srt = cuesToSrt(CUES);
    expect(srt).toBe(
      "1\n00:00:00,000 --> 00:00:01,000\n第一句\n\n2\n00:00:01,000 --> 00:00:01,500\n第二句\n\n",
    );
  });

  it("serializes cues into a WebVTT document", () => {
    const vtt = cuesToVtt(CUES);
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    expect(vtt).toContain("1\n00:00:00.000 --> 00:00:01.000\n第一句\n\n");
    expect(vtt).toContain("2\n00:00:01.000 --> 00:00:01.500\n第二句\n\n");
  });

  it("returns an empty document for an empty cue list", () => {
    expect(cuesToSrt([])).toBe("");
    expect(cuesToVtt([])).toBe("WEBVTT\n\n");
  });

  it("shifts cues and keeps the tick fields consistent", () => {
    const shifted = shiftCues(CUES, 2500);

    expect(shifted[0].startMs).toBe(2500);
    expect(shifted[0].endMs).toBe(3500);
    expect(shifted[1].startMs).toBe(3500);
    expect(shifted[1].endMs).toBe(4000);

    expect(shifted[0].offset).toBe(2500 * 10000);
    expect(shifted[0].duration).toBe(1000 * 10000);
    expect(shifted[1].duration).toBe(500 * 10000);
  });

  it("does not mutate the source cues while shifting", () => {
    shiftCues(CUES, 1000);
    expect(CUES[0].startMs).toBe(0);
    expect(CUES[0].endMs).toBe(1000);
  });
});
