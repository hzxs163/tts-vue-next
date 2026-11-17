//! Azure Speech text-to-speech over the REST API.
//!
//! Requests are authenticated with the resource key (`Ocp-Apim-Subscription-Key`)
//! instead of the DRM token the free Edge endpoint requires, and the response is
//! a plain audio body.

use std::time::Duration;

use super::AzureCredentials;
use crate::edge_tts::errors::EdgeTTSError;
use crate::edge_tts::types::Voice;

/// Output format requested from Azure.
///
/// Identical to what the Edge endpoint produces, which is what lets the caller
/// splice silence frames into the result without re-encoding.
pub const OUTPUT_FORMAT: &str = "audio-24khz-48kbitrate-mono-mp3";

const SYNTHESIS_PATH: &str = "/cognitiveservices/v1";
const VOICES_PATH: &str = "/cognitiveservices/voices/list";

/// Azure rejects a missing or malformed region before it even looks at the key,
/// so a bad region is worth reporting separately from a rejected key.
fn endpoint(region: &str, path: &str) -> String {
    format!("https://{}.tts.speech.microsoft.com{path}", region.trim())
}

pub fn synthesis_url(region: &str) -> String {
    endpoint(region, SYNTHESIS_PATH)
}

pub fn voices_url(region: &str) -> String {
    endpoint(region, VOICES_PATH)
}

fn http_client() -> Result<reqwest::Client, EdgeTTSError> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        // Synthesis of a long paragraph on a paid tier is slower than the free
        // endpoint, so the ceiling is more generous than the voice list uses.
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|error| EdgeTTSError::ConnectionError(error.to_string()))
}

/// Synthesizes one SSML document and returns the encoded audio.
pub async fn synthesize(
    credentials: &AzureCredentials,
    ssml: &str,
    output_format: &str,
) -> Result<Vec<u8>, EdgeTTSError> {
    if !credentials.is_usable() {
        return Err(EdgeTTSError::ConnectionError(
            "Azure region and subscription key are required".into(),
        ));
    }

    // Falling back keeps the audio in the format the caller can splice; an
    // empty value would make Azure pick its own default.
    let output_format = match output_format.trim() {
        "" => OUTPUT_FORMAT,
        value => value,
    };

    let response = http_client()?
        .post(synthesis_url(&credentials.region))
        .header("Ocp-Apim-Subscription-Key", credentials.key.trim())
        .header("Content-Type", "application/ssml+xml")
        .header("X-Microsoft-OutputFormat", output_format)
        // Identifies the client to Azure; the value itself is not validated.
        .header("User-Agent", "tts-vue-next")
        .body(ssml.to_string())
        .send()
        .await
        .map_err(|error| EdgeTTSError::ConnectionError(error.to_string()))?;

    let status = response.status();
    if !status.is_success() {
        // The body carries an actionable reason (bad region, quota, disabled
        // key). It is logged rather than returned because the error type only
        // carries the status code, which is what the frontend classifies on:
        // 401/403 surface as an authentication problem there.
        let detail = response.text().await.unwrap_or_default();
        log::warn!(
            "Azure TTS synthesis failed with {status}: {}",
            detail.trim()
        );
        return Err(EdgeTTSError::HttpError(status.as_u16()));
    }

    let audio = response
        .bytes()
        .await
        .map_err(|error| EdgeTTSError::ConnectionError(error.to_string()))?;

    if audio.is_empty() {
        return Err(EdgeTTSError::NoAudioReceived);
    }

    Ok(audio.to_vec())
}

/// Lists the voices the resource exposes.
///
/// Azure returns the same JSON shape as the Edge endpoint, so the shared
/// [`Voice`] type is reused as-is.
pub async fn list_voices(credentials: &AzureCredentials) -> Result<Vec<Voice>, EdgeTTSError> {
    if !credentials.is_usable() {
        return Err(EdgeTTSError::ConnectionError(
            "Azure region and subscription key are required".into(),
        ));
    }

    let response = http_client()?
        .get(voices_url(&credentials.region))
        .header("Ocp-Apim-Subscription-Key", credentials.key.trim())
        .send()
        .await
        .map_err(|error| EdgeTTSError::ConnectionError(error.to_string()))?;

    let status = response.status();
    if !status.is_success() {
        let detail = response.text().await.unwrap_or_default();
        log::warn!("Azure voice list failed with {status}: {}", detail.trim());
        return Err(EdgeTTSError::HttpError(status.as_u16()));
    }

    let voices = response
        .json::<Vec<Voice>>()
        .await
        .map_err(|error| EdgeTTSError::ConnectionError(error.to_string()))?;

    log::info!(
        "Azure voice list loaded from {}: {} voices",
        credentials.region,
        voices.len()
    );
    Ok(voices)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoints_are_built_from_the_region() {
        assert_eq!(
            synthesis_url("eastasia"),
            "https://eastasia.tts.speech.microsoft.com/cognitiveservices/v1"
        );
        assert_eq!(
            voices_url("westeurope"),
            "https://westeurope.tts.speech.microsoft.com/cognitiveservices/voices/list"
        );
    }

    #[test]
    fn region_is_trimmed_before_building_the_url() {
        // A pasted region often carries a trailing newline.
        assert_eq!(
            synthesis_url("  eastasia\n"),
            "https://eastasia.tts.speech.microsoft.com/cognitiveservices/v1"
        );
    }

    #[test]
    fn credentials_are_only_usable_when_both_fields_are_filled() {
        let full = AzureCredentials {
            key: "abc".into(),
            region: "eastasia".into(),
        };
        assert!(full.is_usable());

        let blank_key = AzureCredentials {
            key: "   ".into(),
            region: "eastasia".into(),
        };
        assert!(!blank_key.is_usable());

        let blank_region = AzureCredentials {
            key: "abc".into(),
            region: "".into(),
        };
        assert!(!blank_region.is_usable());
    }

    #[tokio::test]
    async fn synthesis_rejects_incomplete_credentials_before_any_request() {
        let credentials = AzureCredentials {
            key: "".into(),
            region: "eastasia".into(),
        };
        let error = synthesize(&credentials, "<speak/>", OUTPUT_FORMAT)
            .await
            .expect_err("incomplete credentials must be rejected");
        assert!(error.to_string().contains("subscription key"));
    }

    #[tokio::test]
    async fn voice_list_rejects_incomplete_credentials_before_any_request() {
        let credentials = AzureCredentials {
            key: "abc".into(),
            region: " ".into(),
        };
        let error = list_voices(&credentials)
            .await
            .expect_err("incomplete credentials must be rejected");
        assert!(error.to_string().contains("region"));
    }
}
