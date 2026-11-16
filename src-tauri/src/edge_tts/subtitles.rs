use crate::edge_tts::types::{SubtitleCue, SubtitleTrack};

pub fn ticks_to_ms(ticks: u64) -> u64 {
    ticks / 10_000
}

pub fn ms_to_srt_timestamp(ms: u64) -> String {
    let total_seconds = ms / 1_000;
    let millis = ms % 1_000;
    let hours = total_seconds / 3_600;
    let minutes = (total_seconds % 3_600) / 60;
    let seconds = total_seconds % 60;

    format!("{hours:02}:{minutes:02}:{seconds:02},{millis:03}")
}

pub fn ms_to_vtt_timestamp(ms: u64) -> String {
    let total_seconds = ms / 1_000;
    let millis = ms % 1_000;
    let hours = total_seconds / 3_600;
    let minutes = (total_seconds % 3_600) / 60;
    let seconds = total_seconds % 60;

    format!("{hours:02}:{minutes:02}:{seconds:02}.{millis:03}")
}

pub fn unescape_xml_entities(text: &str) -> String {
    text.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

#[derive(serde::Deserialize)]
struct RawMetadataResponse {
    #[serde(rename = "Metadata", default)]
    metadata: Vec<RawMetadataItem>,
}

#[derive(serde::Deserialize)]
struct RawMetadataItem {
    #[serde(rename = "Type")]
    type_name: String,
    #[serde(rename = "Data")]
    data: RawMetadataData,
}

#[derive(serde::Deserialize)]
struct RawMetadataData {
    #[serde(rename = "Offset")]
    offset: u64,
    #[serde(rename = "Duration")]
    duration: u64,
    #[serde(rename = "text")]
    text: Option<RawMetadataText>,
}

#[derive(serde::Deserialize)]
struct RawMetadataText {
    #[serde(rename = "Text")]
    text: String,
}

pub fn parse_metadata_body(body: &str, offset_compensation_ticks: u64) -> Vec<SubtitleCue> {
    let Ok(parsed) = serde_json::from_str::<RawMetadataResponse>(body) else {
        return Vec::new();
    };

    let mut cues = Vec::new();
    for item in parsed.metadata {
        if item.type_name == "WordBoundary" || item.type_name == "SentenceBoundary" {
            if let Some(text_obj) = item.data.text {
                let text = unescape_xml_entities(&text_obj.text).trim().to_string();
                if text.is_empty() {
                    continue;
                }

                let offset = item.data.offset.saturating_add(offset_compensation_ticks);
                let duration = item.data.duration;
                let start_ms = ticks_to_ms(offset);
                let end_ms = ticks_to_ms(offset.saturating_add(duration));

                cues.push(SubtitleCue {
                    offset,
                    duration,
                    start_ms,
                    end_ms,
                    text,
                });
            }
        }
    }

    cues
}

const SENTENCE_TERMINATORS: [char; 8] = ['。', '！', '？', '；', '!', '?', ';', '\n'];
const CLAUSE_TERMINATORS: [char; 4] = ['，', '、', ',', ':'];

fn needs_space(prev: &str, next: &str) -> bool {
    let Some(prev_last) = prev.chars().last() else {
        return false;
    };
    let Some(next_first) = next.chars().next() else {
        return false;
    };

    (prev_last.is_ascii_alphanumeric() || prev_last == '.' || prev_last == ',')
        && next_first.is_ascii_alphanumeric()
}

/// Groups word-level cues into sentence-level cues.
///
/// The returned cues are what the frontend displays and what the exported
/// SRT/VTT contain, so both stay in sync.
pub fn group_cues_into_sentences(cues: &[SubtitleCue]) -> Vec<SubtitleCue> {
    if cues.is_empty() {
        return Vec::new();
    }

    let mut result: Vec<SubtitleCue> = Vec::new();
    let mut current: Option<SubtitleCue> = None;

    for cue in cues.iter() {
        match current.as_mut() {
            None => {
                current = Some(cue.clone());
            }
            Some(curr) => {
                let pause_gap = cue.start_ms.saturating_sub(curr.end_ms);
                let ends_with_sentence_terminator = curr
                    .text
                    .chars()
                    .last()
                    .map(|ch| SENTENCE_TERMINATORS.contains(&ch))
                    .unwrap_or(false);
                let ends_with_clause_terminator = curr
                    .text
                    .chars()
                    .last()
                    .map(|ch| CLAUSE_TERMINATORS.contains(&ch))
                    .unwrap_or(false);

                let should_split = ends_with_sentence_terminator
                    || pause_gap >= 700
                    || (ends_with_clause_terminator && curr.text.chars().count() >= 18)
                    || curr.text.chars().count() >= 36;

                if should_split {
                    result.push(current.take().unwrap());
                    current = Some(cue.clone());
                } else {
                    if needs_space(&curr.text, &cue.text) {
                        curr.text.push(' ');
                    }
                    curr.text.push_str(&cue.text);
                    curr.end_ms = cue.end_ms;
                }
            }
        }
    }

    if let Some(last) = current.take() {
        result.push(last);
    }

    // Keep the tick based fields consistent with the millisecond fields so
    // downstream consumers can rely on either representation.
    for cue in result.iter_mut() {
        cue.offset = cue.start_ms.saturating_mul(10_000);
        cue.duration = cue.end_ms.saturating_sub(cue.start_ms).saturating_mul(10_000);
    }

    result
}

pub fn cues_to_srt(cues: &[SubtitleCue]) -> String {
    if cues.is_empty() {
        return String::new();
    }

    let mut output = String::new();
    for (idx, cue) in cues.iter().enumerate() {
        let index = idx + 1;
        let start = ms_to_srt_timestamp(cue.start_ms);
        let end = ms_to_srt_timestamp(cue.end_ms);
        output.push_str(&format!("{index}\n{start} --> {end}\n{}\n\n", cue.text));
    }

    output
}

pub fn cues_to_vtt(cues: &[SubtitleCue]) -> String {
    if cues.is_empty() {
        return "WEBVTT\n\n".to_string();
    }

    let mut output = String::from("WEBVTT\n\n");
    for (idx, cue) in cues.iter().enumerate() {
        let index = idx + 1;
        let start = ms_to_vtt_timestamp(cue.start_ms);
        let end = ms_to_vtt_timestamp(cue.end_ms);
        output.push_str(&format!("{index}\n{start} --> {end}\n{}\n\n", cue.text));
    }

    output
}

pub fn build_subtitle_track(mut cues: Vec<SubtitleCue>) -> SubtitleTrack {
    cues.sort_by_key(|cue| cue.start_ms);
    let sentences = group_cues_into_sentences(&cues);
    let srt = cues_to_srt(&sentences);
    let vtt = cues_to_vtt(&sentences);

    SubtitleTrack {
        cues: sentences,
        srt,
        vtt,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ms_to_srt_timestamp() {
        assert_eq!(ms_to_srt_timestamp(0), "00:00:00,000");
        assert_eq!(ms_to_srt_timestamp(1234), "00:00:01,234");
        assert_eq!(ms_to_srt_timestamp(3_661_500), "01:01:01,500");
    }

    #[test]
    fn test_ms_to_vtt_timestamp() {
        assert_eq!(ms_to_vtt_timestamp(1234), "00:00:01.234");
    }

    #[test]
    fn test_parse_metadata_body() {
        let body = r#"{
            "Metadata": [
                {
                    "Type": "WordBoundary",
                    "Data": {
                        "Offset": 10000000,
                        "Duration": 5000000,
                        "text": { "Text": "Hello", "Length": 5, "BoundaryType": "WordBoundary" }
                    }
                },
                {
                    "Type": "WordBoundary",
                    "Data": {
                        "Offset": 15000000,
                        "Duration": 5000000,
                        "text": { "Text": "world", "Length": 5, "BoundaryType": "WordBoundary" }
                    }
                }
            ]
        }"#;

        let cues = parse_metadata_body(body, 0);
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0].text, "Hello");
        assert_eq!(cues[0].start_ms, 1000);
        assert_eq!(cues[0].end_ms, 1500);
        assert_eq!(cues[1].text, "world");
        assert_eq!(cues[1].start_ms, 1500);
        assert_eq!(cues[1].end_ms, 2000);
    }

    #[test]
    fn test_cues_to_srt_groups_words() {
        let cues = vec![
            SubtitleCue {
                offset: 0,
                duration: 5000000,
                start_ms: 0,
                end_ms: 500,
                text: "Hello".to_string(),
            },
            SubtitleCue {
                offset: 5000000,
                duration: 5000000,
                start_ms: 500,
                end_ms: 1000,
                text: "world!".to_string(),
            },
        ];

        let srt = cues_to_srt(&group_cues_into_sentences(&cues));
        assert!(srt.contains("1\n00:00:00,000 --> 00:00:01,000\nHello world!\n\n"));
    }

    #[test]
    fn test_cues_to_srt_chinese_no_space() {
        let cues = vec![
            SubtitleCue {
                offset: 0,
                duration: 5000000,
                start_ms: 0,
                end_ms: 500,
                text: "你好".to_string(),
            },
            SubtitleCue {
                offset: 5000000,
                duration: 5000000,
                start_ms: 500,
                end_ms: 1000,
                text: "世界。".to_string(),
            },
        ];

        let srt = cues_to_srt(&group_cues_into_sentences(&cues));
        assert!(srt.contains("你好世界。"));
        assert!(!srt.contains("你好 世界。"));
    }

    #[test]
    fn test_build_subtitle_track_returns_sentence_level_cues() {
        let cues = vec![
            SubtitleCue {
                offset: 0,
                duration: 5000000,
                start_ms: 0,
                end_ms: 500,
                text: "Hello".to_string(),
            },
            SubtitleCue {
                offset: 5000000,
                duration: 5000000,
                start_ms: 500,
                end_ms: 1000,
                text: "world".to_string(),
            },
        ];

        let track = build_subtitle_track(cues);

        // The cue list must match the exported file, otherwise the on-screen
        // caption would show single words while the .srt shows sentences.
        assert_eq!(track.cues.len(), 1);
        assert_eq!(track.cues[0].text, "Hello world");
        assert_eq!(track.cues[0].start_ms, 0);
        assert_eq!(track.cues[0].end_ms, 1000);
        assert_eq!(track.cues[0].offset, 0);
        assert_eq!(track.cues[0].duration, 10_000_000);
        assert!(track.srt.contains("Hello world"));
        assert!(track.vtt.contains("Hello world"));
    }

    #[test]
    fn test_group_cues_into_sentences_splits_on_sentence_terminator() {
        let cues = vec![
            SubtitleCue {
                offset: 0,
                duration: 5000000,
                start_ms: 0,
                end_ms: 500,
                text: "第一句。".to_string(),
            },
            SubtitleCue {
                offset: 5000000,
                duration: 5000000,
                start_ms: 500,
                end_ms: 1000,
                text: "第二句".to_string(),
            },
        ];

        let sentences = group_cues_into_sentences(&cues);
        assert_eq!(sentences.len(), 2);
        assert_eq!(sentences[0].text, "第一句。");
        assert_eq!(sentences[1].text, "第二句");
    }
}
