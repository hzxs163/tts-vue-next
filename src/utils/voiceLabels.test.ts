import { describe, expect, test } from "vitest";
import type { Voice } from "../types";
import { compactVoiceName, voiceCode, voiceGenderKey, voiceLabel } from "./voiceLabels";

function voice(overrides: Partial<Voice>): Voice {
  return {
    Name: "",
    ShortName: "zh-CN-XiaoxiaoNeural",
    Gender: "Female",
    Locale: "zh-CN",
    SuggestedCodec: "",
    FriendlyName: "",
    Status: "GA",
    VoiceTag: { ContentCategories: [], VoicePersonalities: [] },
    ...overrides,
  };
}

describe("compactVoiceName", () => {
  test("strips the vendor prefix and the trailing locale suffix", () => {
    // This is the shape Azure reports; it is longer than the id it describes.
    expect(
      compactVoiceName(
        voice({
          FriendlyName: "Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)",
        }),
      ),
    ).toBe("Xiaoxiao (Natural)");
  });

  test("keeps a name that is already short", () => {
    expect(compactVoiceName(voice({ FriendlyName: "Xiaoxiao" }))).toBe("Xiaoxiao");
  });

  test("drops the hosting marker without dropping the style", () => {
    expect(
      compactVoiceName(voice({ FriendlyName: "Microsoft Yunxi Multilingual (Lively) - Chinese" })),
    ).toBe("Yunxi (Lively)");
  });

  test("falls back to the short name when there is no friendly name", () => {
    expect(compactVoiceName(voice({ FriendlyName: "" }))).toBe("zh-CN-XiaoxiaoNeural");
  });

  test("falls back to the short name when cleaning leaves nothing", () => {
    expect(compactVoiceName(voice({ FriendlyName: "Microsoft " }))).toBe("zh-CN-XiaoxiaoNeural");
  });
});

describe("voiceLabel", () => {
  test("uses the cleaned friendly name when there is one", () => {
    expect(
      voiceLabel(
        voice({
          FriendlyName: "Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)",
        }),
      ),
    ).toBe("Xiaoxiao (Natural)");
  });

  test("falls back to the id without its locale when the name is the id", () => {
    // Some catalogs report the id itself as the friendly name, so cleaning
    // cannot shorten anything and the field would truncate to "zh-CN-...".
    expect(
      voiceLabel(
        voice({
          Locale: "zh-CN-shandong",
          ShortName: "zh-CN-shandong-XiaoxiaoNeural",
          FriendlyName: "zh-CN-shandong-XiaoxiaoNeural",
        }),
      ),
    ).toBe("Xiaoxiao");
  });
});

describe("voiceCode", () => {
  test("removes the locale prefix so the row shows only the voice", () => {
    expect(
      voiceCode(
        voice({
          Locale: "zh-CN-shandong",
          ShortName: "zh-CN-shandong-XiaoxiaoNeural",
        }),
      ),
    ).toBe("XiaoxiaoNeural");
  });

  test("keeps ids that do not carry their locale as a prefix", () => {
    // OpenAI compatible catalogs use bare names such as "alloy".
    expect(voiceCode(voice({ Locale: "custom", ShortName: "alloy" }))).toBe("alloy");
  });

  test("keeps the Dragon HD style suffix intact", () => {
    expect(
      voiceCode(
        voice({
          ShortName: "zh-CN-Xiaoxiao:DragonHDFlashLatestNeural",
        }),
      ),
    ).toBe("Xiaoxiao:DragonHDFlashLatestNeural");
  });
});

describe("voiceGenderKey", () => {
  test("maps the provider wording to a badge key", () => {
    expect(voiceGenderKey(voice({ Gender: "Female" }))).toBe("female");
    expect(voiceGenderKey(voice({ Gender: "Male" }))).toBe("male");
  });

  test("returns null when the provider omits gender", () => {
    expect(voiceGenderKey(voice({ Gender: "" }))).toBeNull();
    expect(voiceGenderKey(voice({ Gender: "Unknown" }))).toBeNull();
  });
});
