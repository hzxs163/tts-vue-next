/**
 * Generates MPEG-2 Layer III 24kHz 48kbps mono silent MP3 frames.
 * Frame size: 144 bytes, frame duration: 24ms.
 * Matches Microsoft Edge TTS audio format.
 */
export function generateSilentMp3Bytes(durationMs: number): Uint8Array {
  if (durationMs <= 0) {
    return new Uint8Array(0);
  }

  const FRAME_BYTES = 144;
  const FRAME_MS = 24;
  const frameCount = Math.max(1, Math.round(durationMs / FRAME_MS));
  const buffer = new Uint8Array(frameCount * FRAME_BYTES);

  for (let i = 0; i < frameCount; i++) {
    const offset = i * FRAME_BYTES;
    buffer[offset] = 0xff;
    buffer[offset + 1] = 0xf3;
    buffer[offset + 2] = 0x60;
    buffer[offset + 3] = 0xc4;
    // Remaining bytes are initialized to 0
  }

  return buffer;
}

/**
 * Concatenates multiple Uint8Array chunks into a single Uint8Array.
 */
export function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, curr) => acc + curr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Converts milliseconds to SRT timestamp format: HH:MM:SS,mmm
 */
export function msToSrtTime(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const milliseconds = ms % 1000;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}

/**
 * Converts milliseconds to VTT timestamp format: HH:MM:SS.mmm
 */
export function msToVttTime(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const milliseconds = ms % 1000;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}
