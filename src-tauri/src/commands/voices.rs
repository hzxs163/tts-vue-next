use tauri::command;

use crate::edge_tts::types::Voice;
use crate::edge_tts::voices::list_voices;
use crate::tts_provider::{azure, AzureCredentials};

#[command]
pub async fn get_voices() -> Result<Vec<Voice>, String> {
    list_voices().await.map_err(|error| error.to_string())
}

/// Lists the voices of a paid Azure Speech resource.
///
/// Credentials travel with the call rather than being stored on the Rust side,
/// matching how `tts_convert` receives them.
#[command]
pub async fn get_azure_voices(credentials: AzureCredentials) -> Result<Vec<Voice>, String> {
    azure::list_voices(&credentials)
        .await
        .map_err(|error| error.to_string())
}
