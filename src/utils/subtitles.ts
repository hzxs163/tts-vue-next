import type { SubtitleCue } from "../types";
import { msToSrtTime, msToVttTime } from "./audioConcat";

/**
 * Serializes cues into an SRT document.
 *
 * The layout matches the backend implementation byte for byte, so a subtitle
 * exported from the dialogue studio and one exported from the single-text
 * player are interchangeable.
 */
export function cuesToSrt(cues: SubtitleCue[]): string {
  return cues
    .map(
      (cue, index) =>
        `${index + 1}\n${msToSrtTime(cue.startMs)} --> ${msToSrtTime(cue.endMs)}\n${cue.text}\n\n`,
    )
    .join("");
}

/** Serializes cues into a WebVTT document. */
export function cuesToVtt(cues: SubtitleCue[]): string {
  const body = cues
    .map(
      (cue, index) =>
        `${index + 1}\n${msToVttTime(cue.startMs)} --> ${msToVttTime(cue.endMs)}\n${cue.text}\n\n`,
    )
    .join("");

  return `WEBVTT\n\n${body}`;
}

/**
 * Shifts cues by a time offset, keeping the tick based fields consistent with
 * the millisecond fields.
 */
export function shiftCues(cues: SubtitleCue[], offsetMs: number): SubtitleCue[] {
  return cues.map((cue) => {
    const startMs = cue.startMs + offsetMs;
    const endMs = cue.endMs + offsetMs;
    return {
      ...cue,
      offset: startMs * 10000,
      duration: Math.max(0, endMs - startMs) * 10000,
      startMs,
      endMs,
    };
  });
}
