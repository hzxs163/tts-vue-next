use thiserror::Error;

#[derive(Error, Debug)]
pub enum EdgeTTSError {
    #[error("Unexpected response from server: {0}")]
    UnexpectedResponse(String),

    #[error("No audio data received for chunk")]
    NoAudioReceived,

    #[error("WebSocket error: {0}")]
    WebSocketError(String),

    #[error("Clock skew adjustment error: {0}")]
    SkewAdjustmentError(String),

    #[error("Connection error: {0}")]
    ConnectionError(String),

    #[error("HTTP error: status {0}")]
    HttpError(u16),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Request error: {0}")]
    ReqwestError(#[from] reqwest::Error),

    #[error("Cancelled")]
    Cancelled,

    #[error("Task already exists: {0}")]
    TaskAlreadyExists(String),

    #[error("Task not found: {0}")]
    TaskNotFound(String),
}

impl EdgeTTSError {
    /// Stable machine-readable category consumed by the frontend. Keep these
    /// values in sync with `TtsErrorKind` in `src/utils/ttsErrors.ts`.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Cancelled => "cancelled",
            Self::HttpError(401 | 403) => "auth",
            Self::HttpError(408) => "timeout",
            Self::ConnectionError(message) | Self::WebSocketError(message)
                if message.to_ascii_lowercase().contains("timeout") =>
            {
                "timeout"
            }
            Self::HttpError(_)
            | Self::ConnectionError(_)
            | Self::WebSocketError(_)
            | Self::ReqwestError(_) => "network",
            Self::SkewAdjustmentError(_)
            | Self::UnexpectedResponse(_)
            | Self::NoAudioReceived
            | Self::IoError(_)
            | Self::TaskAlreadyExists(_)
            | Self::TaskNotFound(_) => "unknown",
        }
    }

    /// Whether trying the same operation again can plausibly succeed.
    pub fn retryable(&self) -> bool {
        match self {
            Self::Cancelled
            | Self::SkewAdjustmentError(_)
            | Self::UnexpectedResponse(_)
            | Self::TaskAlreadyExists(_)
            | Self::TaskNotFound(_) => false,
            Self::HttpError(status) => *status == 408 || *status == 429 || *status >= 500,
            _ => true,
        }
    }
}

impl serde::Serialize for EdgeTTSError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_codes_match_frontend_contract() {
        assert_eq!(EdgeTTSError::Cancelled.code(), "cancelled");
        assert_eq!(EdgeTTSError::HttpError(403).code(), "auth");
        assert_eq!(EdgeTTSError::HttpError(408).code(), "timeout");
        assert_eq!(EdgeTTSError::HttpError(500).code(), "network");
        assert_eq!(
            EdgeTTSError::ConnectionError("Connection timeout".into()).code(),
            "timeout"
        );
        assert_eq!(
            EdgeTTSError::WebSocketError("Receive timeout".into()).code(),
            "timeout"
        );
        assert_eq!(
            EdgeTTSError::WebSocketError("broken pipe".into()).code(),
            "network"
        );
        assert_eq!(EdgeTTSError::NoAudioReceived.code(), "unknown");
    }

    #[test]
    fn test_retryable_classification() {
        assert!(!EdgeTTSError::Cancelled.retryable());
        assert!(!EdgeTTSError::HttpError(403).retryable());
        assert!(!EdgeTTSError::UnexpectedResponse("x".into()).retryable());
        assert!(EdgeTTSError::HttpError(429).retryable());
        assert!(EdgeTTSError::HttpError(500).retryable());
        assert!(EdgeTTSError::NoAudioReceived.retryable());
    }
}
