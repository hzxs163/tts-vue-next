//! Text to speech over any endpoint that speaks the OpenAI `/audio/speech`
//! protocol.
//!
//! The request shape (`model`, `input`, `voice`, `response_format`, `speed`) is
//! the de facto standard for hosted TTS, so one implementation covers OpenAI
//! itself as well as the many providers that clone its API.
//!
//! The response is requested as raw PCM rather than MP3: provider encoders
//! differ in sample rate and bitrate, and splicing arbitrary MP3 streams
//! produces broken audio. Raw PCM can be joined and padded safely, and is
//! encoded to this project's single output format once at the end.

use std::time::Duration;

use serde::Serialize;

use super::OpenAiCredentials;
use crate::edge_tts::errors::EdgeTTSError;

/// Raw 16-bit mono PCM at 24 kHz is what OpenAI documents for `pcm`.
pub const RESPONSE_FORMAT: &str = "pcm";

/// OpenAI accepts 0.25x to 4x; clamp so an out of range rate cannot 400.
const MIN_SPEED: f64 = 0.25;
const MAX_SPEED: f64 = 4.0;

#[derive(Serialize)]
struct SpeechRequest<'a> {
    model: &'a str,
    input: &'a str,
    voice: &'a str,
    response_format: &'a str,
    speed: f64,
}

/// Builds the speech endpoint from a configured base URL.
///
/// The base URL is whatever the provider documents as its root, usually ending
/// in `/v1`, so a trailing slash is the only thing that needs normalising.
pub fn speech_url(base_url: &str) -> String {
    format!("{}/audio/speech", base_url.trim().trim_end_matches('/'))
}

fn http_client() -> Result<reqwest::Client, EdgeTTSError> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| EdgeTTSError::ConnectionError(error.to_string()))
}

/// Converts this app's signed percentage rate (`"+10%"`, `"-5%"`) into the
/// multiplier the OpenAI protocol expects.
pub fn speed_from_rate(rate: &str) -> f64 {
    let trimmed = rate.trim();
    let (negative, digits) = match trimmed.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, trimmed.strip_prefix('+').unwrap_or(trimmed)),
    };

    let percent = digits
        .trim_end_matches('%')
        .trim()
        .parse::<f64>()
        .unwrap_or(0.0)
        .clamp(-100.0_f64, 900.0);

    let signed = if negative { -percent } else { percent };
    (1.0 + signed / 100.0).clamp(MIN_SPEED, MAX_SPEED)
}

/// Synthesizes one chunk and returns raw PCM.
pub async fn synthesize_pcm(
    credentials: &OpenAiCredentials,
    voice: &str,
    text: &str,
    rate: &str,
) -> Result<Vec<u8>, EdgeTTSError> {
    if !credentials.is_usable() {
        return Err(EdgeTTSError::ConnectionError(
            "OpenAI compatible endpoint needs a base URL and an API key".into(),
        ));
    }

    let body = SpeechRequest {
        model: credentials.model.trim(),
        input: text,
        voice,
        response_format: RESPONSE_FORMAT,
        speed: speed_from_rate(rate),
    };

    let response = http_client()?
        .post(speech_url(&credentials.base_url))
        .header(
            "Authorization",
            format!("Bearer {}", credentials.key.trim()),
        )
        .json(&body)
        .send()
        .await
        .map_err(|error| EdgeTTSError::ConnectionError(error.to_string()))?;

    let status = response.status();
    if !status.is_success() {
        // The body names the offending parameter (model, voice, speed), so log
        // it; the status code is what the frontend classifies on.
        let detail = response.text().await.unwrap_or_default();
        log::warn!("OpenAI TTS failed with {status}: {}", detail.trim());
        return Err(EdgeTTSError::HttpError(status.as_u16()));
    }

    let pcm = response
        .bytes()
        .await
        .map_err(|error| EdgeTTSError::ConnectionError(error.to_string()))?;

    if pcm.is_empty() {
        return Err(EdgeTTSError::NoAudioReceived);
    }

    Ok(pcm.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn speech_url_appends_the_path_and_normalises_slashes() {
        assert_eq!(
            speech_url("https://api.openai.com/v1"),
            "https://api.openai.com/v1/audio/speech"
        );
        assert_eq!(
            speech_url("  https://api.openai.com/v1/  "),
            "https://api.openai.com/v1/audio/speech"
        );
        assert_eq!(
            speech_url("https://api.siliconflow.cn/v1"),
            "https://api.siliconflow.cn/v1/audio/speech"
        );
    }

    #[test]
    fn speed_follows_the_signed_percentage() {
        assert_eq!(speed_from_rate("+0%"), 1.0);
        assert_eq!(speed_from_rate("+10%"), 1.1);
        assert_eq!(speed_from_rate("-20%"), 0.8);
        assert_eq!(speed_from_rate("50%"), 1.5);
    }

    #[test]
    fn speed_is_clamped_to_the_documented_range() {
        // A slider at -100% would otherwise ask for a speed of zero.
        assert_eq!(speed_from_rate("-100%"), MIN_SPEED);
        assert_eq!(speed_from_rate("+900%"), MAX_SPEED);
    }

    #[test]
    fn malformed_rates_fall_back_to_normal_speed() {
        assert_eq!(speed_from_rate(""), 1.0);
        assert_eq!(speed_from_rate("abc"), 1.0);
    }

    #[tokio::test]
    async fn incomplete_credentials_are_rejected_before_any_request() {
        let credentials = OpenAiCredentials {
            key: "".into(),
            base_url: "https://api.openai.com/v1".into(),
            model: "tts-1".into(),
        };
        let error = synthesize_pcm(&credentials, "alloy", "hello", "+0%")
            .await
            .expect_err("missing key must be rejected");
        assert!(error.to_string().contains("API key"));
    }

    #[tokio::test]
    async fn incomplete_base_url_is_rejected_before_any_request() {
        let credentials = OpenAiCredentials {
            key: "sk-test".into(),
            base_url: "  ".into(),
            model: "tts-1".into(),
        };
        let error = synthesize_pcm(&credentials, "alloy", "hello", "+0%")
            .await
            .expect_err("missing base url must be rejected");
        assert!(error.to_string().contains("base URL"));
    }
}
