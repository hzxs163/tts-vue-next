use serde::Serialize;

use crate::edge_tts::errors::EdgeTTSError;

/// Serializable error payload returned to the webview.
///
/// `code` is a stable contract (`auth` | `network` | `timeout` | `cancelled` |
/// `unknown`); `message` keeps the human-readable detail for logs and fallback
/// rendering, and `retryable` tells the UI whether trying again is meaningful.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

impl CommandError {
    pub fn new(code: &str, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
            retryable,
        }
    }
}

impl From<EdgeTTSError> for CommandError {
    fn from(error: EdgeTTSError) -> Self {
        Self {
            code: error.code().to_string(),
            retryable: error.retryable(),
            message: error.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_command_error_from_edge_error_keeps_code_and_retryability() {
        let error = CommandError::from(EdgeTTSError::HttpError(403));

        assert_eq!(error.code, "auth");
        assert!(!error.retryable);
        assert!(error.message.contains("403"));
    }
}
