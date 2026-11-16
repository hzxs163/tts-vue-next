//! Centralised Edge TTS endpoint settings.
//!
//! Microsoft changes the Read Aloud contract without notice. All endpoint and
//! protocol-version values therefore live here, and every one of them can be
//! overridden at process start through environment variables so an urgent
//! migration does not require shipping a new binary.

use std::sync::LazyLock;

use crate::edge_tts::constants::{SEC_MS_GEC_VERSION, USER_AGENT, VOICE_LIST_URL, WSS_URL};

pub const ENV_WSS_URL: &str = "TTS_EDGE_WSS_URL";
pub const ENV_VOICE_LIST_URLS: &str = "TTS_EDGE_VOICE_LIST_URLS";
pub const ENV_GEC_VERSION: &str = "TTS_EDGE_GEC_VERSION";
pub const ENV_USER_AGENT: &str = "TTS_EDGE_USER_AGENT";

#[derive(Debug, Clone)]
pub struct EndpointConfig {
    pub wss_url: String,
    pub voice_list_urls: Vec<String>,
    pub gec_version: String,
    pub user_agent: String,
}

impl EndpointConfig {
    fn load() -> Self {
        let voice_list_urls = std::env::var(ENV_VOICE_LIST_URLS)
            .ok()
            .map(|raw| {
                raw.split(',')
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .filter(|urls| !urls.is_empty())
            .unwrap_or_else(|| vec![VOICE_LIST_URL.to_string()]);

        Self {
            wss_url: env_or(ENV_WSS_URL, WSS_URL),
            voice_list_urls,
            gec_version: env_or(ENV_GEC_VERSION, SEC_MS_GEC_VERSION),
            user_agent: env_or(ENV_USER_AGENT, USER_AGENT),
        }
    }
}

fn env_or(key: &str, fallback: &str) -> String {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

static CONFIG: LazyLock<EndpointConfig> = LazyLock::new(EndpointConfig::load);

pub fn get() -> &'static EndpointConfig {
    &CONFIG
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_env_or_falls_back_for_unset_key() {
        assert_eq!(
            env_or("TTS_EDGE_TEST_UNSET_KEY_XYZ", "fallback"),
            "fallback"
        );
    }

    #[test]
    fn test_default_config_is_usable() {
        let config = EndpointConfig::load();
        assert!(!config.wss_url.is_empty());
        assert!(!config.voice_list_urls.is_empty());
        assert!(!config.gec_version.is_empty());
        assert!(!config.user_agent.is_empty());
    }
}
