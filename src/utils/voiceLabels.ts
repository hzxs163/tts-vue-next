import type { Voice } from "../types";

/**
 * Turns a provider's verbose display name into something that fits a narrow
 * picker.
 *
 * Azure reports names like
 * `Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)`, which is longer
 * than the voice id it is supposed to describe. Stripping the redundant
 * vendor prefix, the trailing locale suffix and the "Online" marker leaves
 * `Xiaoxiao (Natural)`.
 */
export function compactVoiceName(voice: Voice): string {
  const raw = (voice.FriendlyName || voice.ShortName).trim();

  const cleaned = raw
    // `\b` also matches when the name is nothing but the vendor.
    .replace(/^Microsoft\b\s*/i, "")
    // The trailing locale, either " - Chinese (Mainland)" or " - Chinese".
    .replace(/\s+-\s+[^-]*$/, "")
    // "Online" and "Multilingual" describe the hosting, not the voice.
    .replace(/\s+\b(Online|Multilingual)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return cleaned || voice.ShortName;
}

/**
 * The part of the voice id that identifies the voice itself.
 *
 * `zh-CN-shandong-XiaoxiaoNeural` with locale `zh-CN-shandong` becomes
 * `XiaoxiaoNeural`; the locale is already visible in its own picker, so
 * repeating it would only eat the horizontal space the row does not have.
 */
export function voiceCode(voice: Voice): string {
  const prefix = `${voice.Locale}-`;
  if (voice.Locale && voice.ShortName.startsWith(prefix)) {
    return voice.ShortName.slice(prefix.length);
  }
  return voice.ShortName;
}

/**
 * One-line label for the picker's closed field.
 *
 * Some catalogs report the voice id itself as the friendly name, in which case
 * cleaning cannot shorten anything. Falling back to the id without its locale
 * prefix still gives something short and recognisable.
 */
export function voiceLabel(voice: Voice): string {
  const name = compactVoiceName(voice);
  const label = name === voice.ShortName ? voiceCode(voice) : name;
  // Every Azure voice ends in "Neural"; dropping it saves the width the
  // narrow closed field does not have. The full id stays in the menu and in
  // the field's tooltip.
  return label.replace(/Neural$/, "") || label;
}

/** Gender as a short badge, or an empty string when the provider omits it. */
export function voiceGenderKey(voice: Voice): "female" | "male" | null {
  const gender = voice.Gender.trim().toLowerCase();
  if (gender === "female") {
    return "female";
  }
  if (gender === "male") {
    return "male";
  }
  return null;
}
