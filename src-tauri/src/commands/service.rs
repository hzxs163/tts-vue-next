use serde::Serialize;
use tauri::command;

use crate::edge_tts::communicate;
use crate::edge_tts::config;
use crate::edge_tts::errors::EdgeTTSError;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatus {
    pub ok: bool,
    /// `ok` | `auth` | `network` | `timeout`
    pub code: String,
    pub endpoint: String,
    pub message: String,
}

fn classify(error: &EdgeTTSError) -> &'static str {
    match error {
        EdgeTTSError::HttpError(403) => "auth",
        EdgeTTSError::ConnectionError(message)
            if message.to_lowercase().contains("timeout") =>
        {
            "timeout"
        }
        _ => "network",
    }
}

/// Verifies the synthesis endpoint at startup. The voice list endpoint can
/// still return 200 after Microsoft changes the DRM contract, so this probe is
/// what actually detects a broken synthesis path.
#[command]
pub async fn check_tts_service() -> ServiceStatus {
    let endpoint = config::get().wss_url.clone();

    match communicate::probe_wss().await {
        Ok(()) => {
            log::info!("Edge TTS service probe succeeded: {endpoint}");
            ServiceStatus {
                ok: true,
                code: "ok".into(),
                endpoint,
                message: String::new(),
            }
        }
        Err(error) => {
            let code = classify(&error);
            log::warn!("Edge TTS service probe failed ({code}) at {endpoint}: {error}");
            ServiceStatus {
                ok: false,
                code: code.into(),
                endpoint,
                message: error.to_string(),
            }
        }
    }
}
