use crate::edge_tts::constants::MAX_CHUNK_BYTES;
use crate::edge_tts::ssml::{
    parse_break_duration_ms, remove_incompatible_characters, xml_escape, BREAK_TAG_REGEX,
};
use crate::edge_tts::types::SynthesisChunk;

pub fn split_text_by_byte_length(text: &str) -> Vec<String> {
    let cleaned = remove_incompatible_characters(text);
    let escaped = xml_escape(&cleaned);
    let trimmed = escaped.trim();

    if trimmed.is_empty() {
        return vec![];
    }

    let bytes = escaped.as_bytes();
    if bytes.len() <= MAX_CHUNK_BYTES {
        return vec![trimmed.to_string()];
    }

    let mut chunks = Vec::new();
    let mut start = 0;

    while start < bytes.len() {
        let remaining = bytes.len() - start;
        if remaining <= MAX_CHUNK_BYTES {
            let chunk = escaped[start..].trim();
            if !chunk.is_empty() {
                chunks.push(chunk.to_string());
            }
            break;
        }

        let mut end = start + MAX_CHUNK_BYTES;
        while end > start && !escaped.is_char_boundary(end) {
            end -= 1;
        }

        let slice = &escaped[start..end];
        let split_pos = find_split_position(slice);

        let mut actual_end = start + split_pos;
        if let Some(amp_pos) = escaped[start..actual_end].rfind('&') {
            let after_amp = &escaped[start + amp_pos..actual_end];
            if !after_amp.contains(';') {
                actual_end = start + amp_pos;
            }
        }
        if let Some(tag_pos) = escaped[start..actual_end].rfind('<') {
            let after_tag = &escaped[start + tag_pos..actual_end];
            if !after_tag.contains('>') {
                actual_end = start + tag_pos;
            }
        }

        if actual_end <= start {
            actual_end = end;
        }

        let chunk = escaped[start..actual_end].trim();
        if !chunk.is_empty() {
            chunks.push(chunk.to_string());
        }

        start = actual_end;
    }

    chunks
}

/// Plans synthesis chunks by separating pause/break tags from speech text.
/// Break tags become `SynthesisChunk::Silence(millis)`, while text segments
/// are split into bounded chunks via `split_text_by_byte_length`.
pub fn plan_synthesis_chunks(text: &str) -> Vec<SynthesisChunk> {
    let cleaned = remove_incompatible_characters(text);
    let mut chunks = Vec::new();
    let mut last_end = 0;

    for caps in BREAK_TAG_REGEX.find_iter(&cleaned) {
        let match_start = caps.start();
        let match_end = caps.end();

        if match_start > last_end {
            let seg = &cleaned[last_end..match_start];
            for sub in split_text_by_byte_length(seg) {
                chunks.push(SynthesisChunk::Text(sub));
            }
        }

        let captures = BREAK_TAG_REGEX
            .captures(&cleaned[match_start..match_end])
            .unwrap();

        if let Some(millis) = parse_break_duration_ms(&captures) {
            chunks.push(SynthesisChunk::Silence(millis));
        } else {
            for sub in split_text_by_byte_length(&cleaned[match_start..match_end]) {
                chunks.push(SynthesisChunk::Text(sub));
            }
        }

        last_end = match_end;
    }

    if last_end < cleaned.len() {
        let seg = &cleaned[last_end..];
        for sub in split_text_by_byte_length(seg) {
            chunks.push(SynthesisChunk::Text(sub));
        }
    }

    chunks
}

/// Prefer a sentence boundary near the end of the slice, then a clause break,
/// then a word break. Falling back to the hard byte limit keeps languages that
/// do not use spaces (and run-on sentences) working.
///
/// Breaks too close to the start are ignored so a punctuation mark at byte 10
/// cannot produce a tiny chunk.
fn find_split_position(slice: &str) -> usize {
    const MIN_CHUNK_BYTES: usize = MAX_CHUNK_BYTES / 4;
    const SENTENCE_ENDS: [char; 8] = ['。', '！', '？', '；', '!', '?', ';', '\n'];
    const CLAUSE_ENDS: [char; 5] = ['，', '、', ',', '：', ':'];

    let mut sentence_split = None;
    let mut clause_split = None;
    let mut word_split = None;

    for (index, ch) in slice.char_indices() {
        let split_at = index + ch.len_utf8();

        if SENTENCE_ENDS.contains(&ch) {
            sentence_split = Some(split_at);
        } else if CLAUSE_ENDS.contains(&ch) {
            clause_split = Some(split_at);
        } else if ch.is_whitespace() {
            word_split = Some(split_at);
        }
    }

    sentence_split
        .filter(|position| *position >= MIN_CHUNK_BYTES)
        .or(clause_split.filter(|position| *position >= MIN_CHUNK_BYTES))
        .or(word_split.filter(|position| *position >= MIN_CHUNK_BYTES))
        .unwrap_or(slice.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_short_text_no_split() {
        let chunks = split_text_by_byte_length("Hello world");
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0], "Hello world");
    }

    #[test]
    fn test_empty_text() {
        let chunks = split_text_by_byte_length("");
        assert!(chunks.is_empty());
    }

    #[test]
    fn test_whitespace_only() {
        let chunks = split_text_by_byte_length("   \n\n   ");
        assert!(chunks.is_empty());
    }

    #[test]
    fn test_long_text_splits() {
        let text = "a ".repeat(3000);
        let chunks = split_text_by_byte_length(&text);
        assert!(chunks.len() > 1);
        for chunk in &chunks {
            assert!(chunk.len() <= MAX_CHUNK_BYTES);
        }
    }

    #[test]
    fn test_xml_escape_in_split() {
        let text = "Hello & world < test > end";
        let chunks = split_text_by_byte_length(text);
        assert_eq!(chunks.len(), 1);
        assert!(chunks[0].contains("&amp;"));
        assert!(chunks[0].contains("&lt;"));
        assert!(chunks[0].contains("&gt;"));
    }

    #[test]
    fn test_prefers_sentence_boundaries() {
        let first = "这".repeat(1200);
        let second = "那".repeat(1200);
        let text = format!("{first}。{second}。");

        let chunks = split_text_by_byte_length(&text);

        assert!(chunks.len() >= 2);
        assert!(
            chunks[0].ends_with('。'),
            "first chunk should end a sentence"
        );
        assert!(chunks[0].len() <= MAX_CHUNK_BYTES);
        assert_eq!(chunks.concat(), text, "splitting must not lose text");
    }

    #[test]
    fn test_multibyte_utf8_protection() {
        let text = "你".repeat(2000);
        let chunks = split_text_by_byte_length(&text);
        assert!(chunks.len() > 1);
        for chunk in &chunks {
            assert!(chunk.is_char_boundary(0));
            assert!(chunk.len() <= MAX_CHUNK_BYTES);
        }
    }

    #[test]
    fn test_plan_synthesis_chunks_with_pause_tags() {
        let text = "今天的天气[停顿 1s]确实不错啊";
        let plan = plan_synthesis_chunks(text);
        assert_eq!(
            plan,
            vec![
                SynthesisChunk::Text("今天的天气".to_string()),
                SynthesisChunk::Silence(1000),
                SynthesisChunk::Text("确实不错啊".to_string()),
            ]
        );
    }

    #[test]
    fn test_plan_synthesis_chunks_with_chinese_brackets() {
        let text = "今天的天气【停顿 500ms】确实不错啊";
        let plan = plan_synthesis_chunks(text);
        assert_eq!(
            plan,
            vec![
                SynthesisChunk::Text("今天的天气".to_string()),
                SynthesisChunk::Silence(500),
                SynthesisChunk::Text("确实不错啊".to_string()),
            ]
        );
    }

    #[test]
    fn test_plan_synthesis_chunks_with_break_tags() {
        let text = r#"Hello <break time="2s" /> World"#;
        let plan = plan_synthesis_chunks(text);
        assert_eq!(
            plan,
            vec![
                SynthesisChunk::Text("Hello".to_string()),
                SynthesisChunk::Silence(2000),
                SynthesisChunk::Text("World".to_string()),
            ]
        );
    }
}
