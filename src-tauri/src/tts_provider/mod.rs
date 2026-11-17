//! Speech service providers other than the free Edge endpoint.
//!
//! The Edge client speaks a WebSocket protocol that Edge and Azure share, but
//! the REST API of Azure is enough for the cast pipeline and is far simpler to
//! maintain. Crucially it can emit the *same* format the Edge client uses
//! (`audio-24khz-48kbitrate-mono-mp3`), so the existing byte level
//! concatenation and silence splicing keep working without a transcoding pass.

use serde::Deserialize;

pub mod azure;

/// Which speech service a conversion should be routed to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TtsProvider {
    /// The free Edge read-aloud endpoint.
    #[default]
    Edge,
    /// A paid Azure Speech resource.
    Azure,
}

/// Credentials of an Azure Speech resource.
///
/// Kept in memory only: the key travels with each request from the frontend
/// settings instead of being persisted on the Rust side.
#[derive(Debug, Clone, Deserialize)]
pub struct AzureCredentials {
    pub key: String,
    pub region: String,
}

impl AzureCredentials {
    /// A resource is only usable once both fields are filled in.
    pub fn is_usable(&self) -> bool {
        !self.key.trim().is_empty() && !self.region.trim().is_empty()
    }
}
