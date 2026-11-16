/**
 * MPEG-2 Layer III frame header of the Edge TTS 24kHz/48kbps/mono stream.
 *
 * Byte layout: `FF F3 64 C4`
 *  - `FF F3`  sync + MPEG-2 + Layer III + no CRC
 *  - `64`     bitrate index 6 (48 kbps) + sample rate index 1 (24000 Hz)
 *  - `C4`     mono channel mode
 *
 * The sample rate byte MUST stay `0x64`. `0x60` would mean index 0 (22050 Hz),
 * which makes the 144-byte frame length invalid (72 * 48000 / 22050 = 156.7)
 * and makes decoders lose frame sync mid-stream.
 */
const EDGE_TTS_FRAME_HEADER = [0xff, 0xf3, 0x64, 0xc4] as const;

/** MPEG-2 Layer III frame size at 24 kHz / 48 kbps: 72 * 48000 / 24000 = 144 bytes. */
const FRAME_BYTES = 144;
/** Each frame carries 576 samples at 24 kHz, i.e. exactly 24 ms. */
const FRAME_MS = 24;

/**
 * Generates MPEG-2 Layer III 24kHz 48kbps mono silent MP3 frames.
 * Frame size: 144 bytes, frame duration: 24ms.
 * Matches Microsoft Edge TTS audio format.
 */
export function generateSilentMp3Bytes(durationMs: number): Uint8Array {
  if (durationMs <= 0) {
    return new Uint8Array(0);
  }

  const frameCount = Math.max(1, Math.round(durationMs / FRAME_MS));
  const buffer = new Uint8Array(frameCount * FRAME_BYTES);

  for (let i = 0; i < frameCount; i++) {
    const offset = i * FRAME_BYTES;
    buffer[offset] = EDGE_TTS_FRAME_HEADER[0];
    buffer[offset + 1] = EDGE_TTS_FRAME_HEADER[1];
    buffer[offset + 2] = EDGE_TTS_FRAME_HEADER[2];
    buffer[offset + 3] = EDGE_TTS_FRAME_HEADER[3];
    // Remaining bytes are initialized to 0: a zeroed side-info block makes the
    // decoder emit digital silence instead of pulling stale bits out of the
    // bit reservoir of the preceding speech frame.
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
