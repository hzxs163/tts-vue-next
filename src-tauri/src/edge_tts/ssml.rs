use std::sync::LazyLock;
use crate::edge_tts::types::TTSConfig;

pub static BREAK_TAG_REGEX: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(
        r#"(?i)(?:\[|【)(?:停顿|pause)[:：\s]*(\d+(?:\.\d+)?)\s*(ms|s|秒|毫秒)?(?:\]|】)|<\s*break\s+time=["'](\d+(?:\.\d+)?)\s*(ms|s|秒|毫秒)?["']\s*/?>"#,
    )
    .expect("invalid BREAK_TAG_REGEX")
});

pub fn parse_break_duration_ms(captures: &regex::Captures) -> Option<u64> {
    let (val_str, unit_str) = if let Some(val) = captures.get(1) {
        (val.as_str(), captures.get(2).map(|m| m.as_str()).unwrap_or(""))
    } else if let Some(val) = captures.get(3) {
        (val.as_str(), captures.get(4).map(|m| m.as_str()).unwrap_or(""))
    } else {
        return None;
    };

    let val = val_str.parse::<f64>().ok()?;
    let unit_lower = unit_str.to_ascii_lowercase();
    let millis = if unit_lower == "ms" || unit_str == "毫秒" {
        val.round() as u64
    } else if unit_lower == "s" || unit_str == "秒" || val <= 10.0 {
        (val * 1000.0).round() as u64
    } else {
        val.round() as u64
    };

    Some(millis.clamp(10, 30_000))
}

/// Generates standard MPEG-2 Layer III 24kHz 48kbps mono MP3 silent frames.
/// Each frame is 144 bytes and corresponds to exactly 24ms of audio (576 samples at 24kHz).
pub fn generate_silent_mp3(duration_ms: u64) -> Vec<u8> {
    const FRAME_MS: u64 = 24;
    const FRAME_SIZE: usize = 144;
    let num_frames = ((duration_ms + FRAME_MS / 2) / FRAME_MS).max(1) as usize;

    let mut frame = [0xAAu8; FRAME_SIZE];
    frame[0] = 0xFF;
    frame[1] = 0xF3;
    frame[2] = 0x64;
    frame[3] = 0xC4;
    frame[4] = 0x7C;
    frame[5] = 0x00;
    frame[6] = 0x00;
    frame[7] = 0x03;
    frame[8] = 0x48;
    frame[9] = 0x00;
    frame[10] = 0x00;
    frame[11] = 0x00;
    frame[12] = 0x00;

    let mut result = Vec::with_capacity(num_frames * FRAME_SIZE);
    for _ in 0..num_frames {
        result.extend_from_slice(&frame);
    }
    result
}

pub fn xml_escape(text: &str) -> String {
    let mut result = String::with_capacity(text.len());

    for ch in text.chars() {
        match ch {
            '&' => result.push_str("&amp;"),
            '<' => result.push_str("&lt;"),
            '>' => result.push_str("&gt;"),
            '"' => result.push_str("&quot;"),
            '\'' => result.push_str("&apos;"),
            _ => result.push(ch),
        }
    }

    result
}

/// Escapes XML special characters in user text while preserving and normalizing
/// user pause tags (`[停顿 500ms]`, `[pause 1s]`, `<break time="500ms" />`).
#[allow(dead_code)]
pub fn escape_text_with_breaks(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut last_end = 0;

    for caps in BREAK_TAG_REGEX.find_iter(text) {
        let match_start = caps.start();
        let match_end = caps.end();

        if match_start > last_end {
            result.push_str(&xml_escape(&text[last_end..match_start]));
        }

        let captures = BREAK_TAG_REGEX
            .captures(&text[match_start..match_end])
            .unwrap();

        if let Some(millis) = parse_break_duration_ms(&captures) {
            result.push_str(&format!(r#"<break time="{millis}ms" />"#));
        } else {
            result.push_str(&xml_escape(&text[match_start..match_end]));
        }

        last_end = match_end;
    }

    if last_end < text.len() {
        result.push_str(&xml_escape(&text[last_end..]));
    }

    result
}

pub fn build_ssml(config: &TTSConfig, escaped_text: &str) -> String {
    let voice_name = config.voice_long_name();

    format!(
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>\
         <voice name='{}'>\
         <prosody pitch='{}' rate='{}' volume='{}'>\
         {}\
         </prosody>\
         </voice>\
         </speak>",
        voice_name, config.pitch, config.rate, config.volume, escaped_text
    )
}

pub fn remove_incompatible_characters(text: &str) -> String {
    text.chars()
        .map(|ch| {
            let code_point = ch as u32;
            if (code_point <= 0x08)
                || (code_point == 0x0B)
                || (code_point == 0x0C)
                || (0x0E..=0x1F).contains(&code_point)
            {
                ' '
            } else {
                ch
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_xml_escape() {
        assert_eq!(xml_escape("a & b < c > d"), "a &amp; b &lt; c &gt; d");
        assert_eq!(xml_escape("hello"), "hello");
        assert_eq!(xml_escape("\"quoted\""), "&quot;quoted&quot;");
    }

    #[test]
    fn test_build_ssml_structure() {
        let config = TTSConfig::default();
        let ssml = build_ssml(&config, "Hello world");
        assert!(ssml.contains("<speak version='1.0'"));
        assert!(ssml.contains("xml:lang='en-US'"));
        assert!(ssml.contains("EmmaMultilingualNeural"));
        assert!(ssml.contains("rate='+0%'"));
        assert!(ssml.contains("pitch='+0Hz'"));
        assert!(ssml.contains("Hello world"));
    }

    #[test]
    fn test_remove_incompatible_characters() {
        let input = "hello\x00\x01\tworld\n\x0Bfoo";
        let result = remove_incompatible_characters(input);
        assert_eq!(result, "hello  \tworld\n foo");
    }

    #[test]
    fn test_escape_text_with_breaks() {
        assert_eq!(
            escape_text_with_breaks("你好 [停顿 500ms] 世界 & 朋友"),
            r#"你好 <break time="500ms" /> 世界 &amp; 朋友"#
        );
        assert_eq!(
            escape_text_with_breaks("Wait [pause 1.5s] done."),
            r#"Wait <break time="1500ms" /> done."#
        );
        assert_eq!(
            escape_text_with_breaks("你好【停顿 1s】世界"),
            r#"你好<break time="1000ms" />世界"#
        );
        assert_eq!(
            escape_text_with_breaks(r#"A <break time="800ms" /> B"#),
            r#"A <break time="800ms" /> B"#
        );
        assert_eq!(
            escape_text_with_breaks("测试 [停顿 10s]"),
            r#"测试 <break time="10000ms" />"#
        );
    }

    #[test]
    fn test_generate_silent_mp3() {
        let audio_1s = generate_silent_mp3(1000);
        assert_eq!(audio_1s.len() % 144, 0);
        assert_eq!(audio_1s.len(), 42 * 144);
        assert_eq!(audio_1s[0], 0xFF);
        assert_eq!(audio_1s[1], 0xF3);
        assert_eq!(audio_1s[2], 0x64);
        assert_eq!(audio_1s[3], 0xC4);
    }
}
