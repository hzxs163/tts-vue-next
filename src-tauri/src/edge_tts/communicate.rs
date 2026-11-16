use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use futures_util::stream::FuturesUnordered;
use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpStream;
use tokio::sync::watch;
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Error as WebSocketError, Message};
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};
use url::Url;
use uuid::Uuid;

use crate::edge_tts::config;
use crate::edge_tts::constants::{
    CHROMIUM_MAJOR_VERSION, CONNECT_TIMEOUT_SECS, ORIGIN, RECEIVE_TIMEOUT_SECS,
    TRUSTED_CLIENT_TOKEN,
};
use crate::edge_tts::drm::{adjust_clock_skew, generate_muid, generate_sec_ms_gec, js_date_string};
use crate::edge_tts::errors::EdgeTTSError;
use crate::edge_tts::split_text::plan_synthesis_chunks;
use crate::edge_tts::ssml::{build_ssml, generate_silent_mp3};
use crate::edge_tts::subtitles::{build_subtitle_track, parse_metadata_body, ticks_to_ms};
use crate::edge_tts::types::{SubtitleCue, SubtitleTrack, SynthesisChunk, TTSConfig};

type EdgeWebSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(CONNECT_TIMEOUT_SECS);
const RECEIVE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(RECEIVE_TIMEOUT_SECS);
/// Upper bound for parallel chunk synthesis. The batch queue multiplies this by
/// its file concurrency, so keep it conservative to stay friendly to the service.
const MAX_CHUNK_CONCURRENCY: usize = 8;

pub struct Communicate {
    config: TTSConfig,
    text: String,
    cancel_rx: watch::Receiver<bool>,
    progress: Option<Arc<dyn Fn(usize, usize) + Send + Sync>>,
    chunk_concurrency: usize,
}

impl Communicate {
    pub fn new(text: String, config: TTSConfig, cancel_rx: watch::Receiver<bool>) -> Self {
        Self {
            config,
            text,
            cancel_rx,
            progress: None,
            chunk_concurrency: 1,
        }
    }

    /// Subscribe to `(completed_chunks, total_chunks)` updates.
    pub fn with_progress<F>(mut self, callback: F) -> Self
    where
        F: Fn(usize, usize) + Send + Sync + 'static,
    {
        self.progress = Some(Arc::new(callback));
        self
    }

    /// Number of text chunks synthesized in parallel, clamped to `1..=8`.
    pub fn with_chunk_concurrency(mut self, chunk_concurrency: usize) -> Self {
        self.chunk_concurrency = chunk_concurrency.clamp(1, MAX_CHUNK_CONCURRENCY);
        self
    }

    #[allow(dead_code)]
    pub async fn stream_audio(&self) -> Result<Vec<u8>, EdgeTTSError> {
        let (audio, _) = self.stream_audio_with_subtitles().await?;
        Ok(audio)
    }

    pub async fn stream_audio_with_subtitles(
        &self,
    ) -> Result<(Vec<u8>, SubtitleTrack), EdgeTTSError> {
        self.stream_chunk_sequence_with_timeout(config::get().wss_url.as_str(), RECEIVE_TIMEOUT)
            .await
    }

    #[cfg(test)]
    async fn stream_audio_with_timeout(
        &self,
        base_url: &str,
        receive_timeout: std::time::Duration,
    ) -> Result<Vec<u8>, EdgeTTSError> {
        let (audio, _) = self
            .stream_chunk_sequence_with_timeout(base_url, receive_timeout)
            .await?;
        Ok(audio)
    }

    async fn stream_chunk_sequence_with_timeout(
        &self,
        base_url: &str,
        receive_timeout: std::time::Duration,
    ) -> Result<(Vec<u8>, SubtitleTrack), EdgeTTSError> {
        if *self.cancel_rx.borrow() {
            return Err(EdgeTTSError::Cancelled);
        }

        let plan = plan_synthesis_chunks(&self.text);
        if plan.is_empty() {
            return Err(EdgeTTSError::NoAudioReceived);
        }

        let total = plan.len();
        let concurrency = self.chunk_concurrency.clamp(1, total);
        let completed = Arc::new(AtomicUsize::new(0));

        // Chunks are synthesized concurrently, but audio must be concatenated in
        // text order; the index travels with each result for the final sort.
        let mut pending = FuturesUnordered::new();
        let mut ordered: Vec<(usize, Vec<u8>, Vec<SubtitleCue>)> = Vec::with_capacity(total);
        let mut next_chunk = 0;

        while next_chunk < total || !pending.is_empty() {
            while next_chunk < total && pending.len() < concurrency {
                let index = next_chunk;
                let chunk_item = plan[index].clone();
                let completed = Arc::clone(&completed);
                let progress = self.progress.clone();
                next_chunk += 1;

                match chunk_item {
                    SynthesisChunk::Silence(duration_ms) => {
                        let audio = generate_silent_mp3(duration_ms);
                        let done = completed.fetch_add(1, Ordering::SeqCst) + 1;
                        if let Some(callback) = &progress {
                            callback(done, total);
                        }
                        ordered.push((index, audio, Vec::new()));
                    }
                    SynthesisChunk::Text(chunk_text) => {
                        let cancel_rx = self.cancel_rx.clone();
                        let base_url = base_url.to_string();
                        pending.push(async move {
                            if *cancel_rx.borrow() {
                                return Err(EdgeTTSError::Cancelled);
                            }

                            let (audio, cues) = self
                                .stream_single_chunk_with_timeout(
                                    &chunk_text,
                                    &base_url,
                                    receive_timeout,
                                )
                                .await?;

                            let done = completed.fetch_add(1, Ordering::SeqCst) + 1;
                            if let Some(callback) = &progress {
                                callback(done, total);
                            }

                            Ok::<(usize, Vec<u8>, Vec<SubtitleCue>), EdgeTTSError>((
                                index, audio, cues,
                            ))
                        });
                    }
                }
            }

            if !pending.is_empty() {
                if let Some(result) = pending.next().await {
                    ordered.push(result?);
                }
            }
        }

        ordered.sort_by_key(|(index, _, _)| *index);

        let mut all_audio = Vec::new();
        let mut all_cues = Vec::new();
        let mut cumulative_bytes: u64 = 0;

        for (_, audio, cues) in ordered {
            // Edge TTS 48kbps CBR: 48,000 bits/sec = 6,000 bytes/sec
            // Ticks per byte: 8 * 10_000_000 / 48_000 = 5000 / 3
            let chunk_offset_ticks = cumulative_bytes * 5000 / 3;
            for mut cue in cues {
                cue.offset = cue.offset.saturating_add(chunk_offset_ticks);
                cue.start_ms = ticks_to_ms(cue.offset);
                cue.end_ms = ticks_to_ms(cue.offset.saturating_add(cue.duration));
                all_cues.push(cue);
            }
            cumulative_bytes = cumulative_bytes.saturating_add(audio.len() as u64);
            all_audio.extend_from_slice(&audio);
        }

        if all_audio.is_empty() {
            Err(EdgeTTSError::NoAudioReceived)
        } else {
            let track = build_subtitle_track(all_cues);
            Ok((all_audio, track))
        }
    }

    async fn stream_single_chunk_with_timeout(
        &self,
        chunk_text: &str,
        base_url: &str,
        receive_timeout: std::time::Duration,
    ) -> Result<(Vec<u8>, Vec<SubtitleCue>), EdgeTTSError> {
        let mut socket = self.connect_websocket(base_url).await?;
        let request_id = generate_request_id();

        socket
            .send(Message::Text(
                build_speech_config_message(&self.config).into(),
            ))
            .await
            .map_err(map_websocket_message_error)?;
        socket
            .send(Message::Text(
                build_ssml_message(&request_id, chunk_text, &self.config).into(),
            ))
            .await
            .map_err(map_websocket_message_error)?;

        let mut audio = Vec::new();
        let mut cues = Vec::new();
        let mut cancel_rx = self.cancel_rx.clone();

        loop {
            if *cancel_rx.borrow() {
                return Err(EdgeTTSError::Cancelled);
            }

            let message = tokio::select! {
                changed = cancel_rx.changed() => {
                    match changed {
                        Ok(()) if *cancel_rx.borrow() => return Err(EdgeTTSError::Cancelled),
                        Ok(()) => continue,
                        Err(_) => continue,
                    }
                }
                message = tokio::time::timeout(
                    receive_timeout,
                    socket.next(),
                ) => {
                    match message {
                        Ok(message) => message,
                        Err(_) => return Err(EdgeTTSError::WebSocketError("Receive timeout".to_string())),
                    }
                }
            };

            let Some(message_result) = message else {
                break;
            };

            let message = message_result.map_err(map_websocket_message_error)?;

            match message {
                Message::Text(text) => {
                    let (headers, body) = parse_text_message(text.as_str());
                    match headers.get("Path").map(String::as_str) {
                        Some("turn.start" | "response") => {}
                        Some("audio.metadata") => {
                            let parsed = parse_metadata_body(body, 0);
                            cues.extend(parsed);
                        }
                        Some("turn.end") => break,
                        Some(other) => {
                            return Err(EdgeTTSError::UnexpectedResponse(format!(
                                "Unknown Path in text message: {other}"
                            )));
                        }
                        None => {
                            return Err(EdgeTTSError::UnexpectedResponse(
                                "Missing Path in text message".to_string(),
                            ));
                        }
                    }
                }
                Message::Binary(data) => {
                    if let Some((headers, payload)) = parse_binary_message(data.as_ref()) {
                        match headers.get("Path").map(String::as_str) {
                            Some("audio") if !payload.is_empty() => {
                                audio.extend_from_slice(payload);
                            }
                            Some("turn.end") => break,
                            _ => {}
                        }
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }

        if audio.is_empty() {
            Err(EdgeTTSError::NoAudioReceived)
        } else {
            Ok((audio, cues))
        }
    }

    async fn connect_websocket(&self, base_url: &str) -> Result<EdgeWebSocket, EdgeTTSError> {
        self.connect_websocket_with_timeout(base_url, CONNECT_TIMEOUT)
            .await
    }

    async fn connect_websocket_with_timeout(
        &self,
        base_url: &str,
        connect_timeout: std::time::Duration,
    ) -> Result<EdgeWebSocket, EdgeTTSError> {
        match connect_websocket_once(base_url, connect_timeout).await {
            Ok(socket) => Ok(socket),
            Err(ConnectAttemptError::Forbidden(date_header)) => {
                if let Some(date) = date_header {
                    adjust_clock_skew(&date).map_err(EdgeTTSError::SkewAdjustmentError)?;
                }

                match connect_websocket_once(base_url, connect_timeout).await {
                    Ok(socket) => Ok(socket),
                    Err(ConnectAttemptError::Forbidden(_)) => Err(EdgeTTSError::HttpError(403)),
                    Err(ConnectAttemptError::Edge(error)) => Err(error),
                }
            }
            Err(ConnectAttemptError::Edge(error)) => Err(error),
        }
    }
}

async fn connect_websocket_once(
    base_url: &str,
    connect_timeout: std::time::Duration,
) -> Result<EdgeWebSocket, ConnectAttemptError> {
    let url = build_websocket_url(base_url).map_err(ConnectAttemptError::Edge)?;
    let mut request = url.into_client_request().map_err(|error| {
        ConnectAttemptError::Edge(EdgeTTSError::ConnectionError(error.to_string()))
    })?;

    request
        .headers_mut()
        .insert("Origin", ORIGIN.parse().unwrap());
    request
        .headers_mut()
        .insert("User-Agent", config::get().user_agent.parse().unwrap());
    request.headers_mut().insert(
        "Sec-CH-UA",
        format!(
            "\" Not;A Brand\";v=\"99\", \"Microsoft Edge\";v=\"{CHROMIUM_MAJOR_VERSION}\", \"Chromium\";v=\"{CHROMIUM_MAJOR_VERSION}\""
        )
        .parse()
        .unwrap(),
    );
    request
        .headers_mut()
        .insert("Sec-CH-UA-Mobile", "?0".parse().unwrap());
    request.headers_mut().insert(
        "Cookie",
        format!("muid={};", generate_muid()).parse().unwrap(),
    );

    let connect_result = tokio::time::timeout(connect_timeout, connect_async(request))
        .await
        .map_err(|_| {
            ConnectAttemptError::Edge(EdgeTTSError::ConnectionError(
                "Connection timeout".to_string(),
            ))
        })?;

    match connect_result {
        Ok((socket, _)) => Ok(socket),
        Err(WebSocketError::Http(response)) => {
            let status = response.status().as_u16();
            if status == 403 {
                let date_header = response
                    .headers()
                    .get("date")
                    .and_then(|value| value.to_str().ok())
                    .map(str::to_string);
                Err(ConnectAttemptError::Forbidden(date_header))
            } else {
                Err(ConnectAttemptError::Edge(EdgeTTSError::HttpError(status)))
            }
        }
        Err(error) => Err(ConnectAttemptError::Edge(EdgeTTSError::ConnectionError(
            error.to_string(),
        ))),
    }
}

/// Lightweight handshake probe used at application start. A working voice
/// list endpoint does not prove synthesis works, so the WSS endpoint has to
/// be checked separately.
pub async fn probe_wss() -> Result<(), EdgeTTSError> {
    let url = config::get().wss_url.clone();

    match connect_websocket_once(&url, CONNECT_TIMEOUT).await {
        Ok(_socket) => Ok(()),
        Err(ConnectAttemptError::Forbidden(date_header)) => {
            if let Some(date) = date_header {
                let _ = adjust_clock_skew(&date);
            }
            Err(EdgeTTSError::HttpError(403))
        }
        Err(ConnectAttemptError::Edge(error)) => Err(error),
    }
}

fn build_websocket_url(base_url: &str) -> Result<String, EdgeTTSError> {
    let mut url =
        Url::parse(base_url).map_err(|error| EdgeTTSError::ConnectionError(error.to_string()))?;
    let connection_id = generate_request_id();
    let sec_ms_gec = generate_sec_ms_gec();

    url.query_pairs_mut()
        .append_pair("TrustedClientToken", TRUSTED_CLIENT_TOKEN)
        .append_pair("Sec-MS-GEC", &sec_ms_gec)
        .append_pair("Sec-MS-GEC-Version", config::get().gec_version.as_str())
        .append_pair("ConnectionId", &connection_id);

    Ok(url.into())
}

fn build_speech_config_message(config: &TTSConfig) -> String {
    let timestamp = js_date_string();
    let body = serde_json::json!({
        "context": {
            "synthesis": {
                "audio": {
                    "metadataoptions": {
                        "sentenceBoundaryEnabled": false,
                        "wordBoundaryEnabled": true
                    },
                    "outputFormat": config.output_format
                }
            }
        }
    });

    format!(
        "X-Timestamp:{timestamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{body}"
    )
}

fn build_ssml_message(request_id: &str, text: &str, config: &TTSConfig) -> String {
    let ssml = build_ssml(config, text.trim());
    let timestamp = js_date_string();

    format!(
        "X-RequestId:{request_id}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:{timestamp}\r\nPath:ssml\r\n\r\n{ssml}"
    )
}

fn parse_text_message(text: &str) -> (HashMap<String, String>, &str) {
    match text.split_once("\r\n\r\n") {
        Some((headers_str, body)) => (parse_header_string(headers_str), body),
        None => (parse_header_string(text), ""),
    }
}

fn parse_header_string(headers_str: &str) -> HashMap<String, String> {
    headers_str
        .lines()
        .filter_map(|line| {
            let (key, value) = line.split_once(':')?;
            Some((key.trim().to_string(), value.trim().to_string()))
        })
        .collect()
}

fn parse_binary_message(data: &[u8]) -> Option<(HashMap<String, String>, &[u8])> {
    let header_length_bytes: [u8; 2] = data.get(..2)?.try_into().ok()?;
    let header_length = u16::from_be_bytes(header_length_bytes) as usize;
    let header_end = 2 + header_length;
    let header_bytes = data.get(2..header_end)?;
    let headers_str = std::str::from_utf8(header_bytes).ok()?;
    let payload = data.get(header_end..)?;

    Some((parse_header_string(headers_str), payload))
}

fn generate_request_id() -> String {
    Uuid::new_v4().simple().to_string().to_uppercase()
}

fn map_websocket_message_error(error: WebSocketError) -> EdgeTTSError {
    match error {
        WebSocketError::Http(response) => EdgeTTSError::HttpError(response.status().as_u16()),
        other => EdgeTTSError::WebSocketError(other.to_string()),
    }
}

enum ConnectAttemptError {
    Forbidden(Option<String>),
    Edge(EdgeTTSError),
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    use tokio::net::TcpListener;
    use tokio::time::sleep;
    use tokio_tungstenite::accept_async;

    use crate::edge_tts::split_text::split_text_by_byte_length;

    #[test]
    fn test_parse_text_message_splits_headers_and_body() {
        let message = concat!(
            "X-RequestId:abc\r\n",
            "Path:turn.end\r\n",
            "Content-Type:application/json\r\n\r\n",
            "{\"ok\":true}"
        );

        let (headers, body) = parse_text_message(message);

        assert_eq!(headers.get("X-RequestId"), Some(&"abc".to_string()));
        assert_eq!(headers.get("Path"), Some(&"turn.end".to_string()));
        assert_eq!(body, "{\"ok\":true}");
    }

    #[test]
    fn test_parse_binary_message_extracts_audio_payload() {
        let headers = b"Path:audio\r\nContent-Type:audio/mpeg";
        let mut frame = Vec::new();
        frame.extend_from_slice(&(headers.len() as u16).to_be_bytes());
        frame.extend_from_slice(headers);
        frame.extend_from_slice(b"abc123");

        let (parsed_headers, payload) = parse_binary_message(&frame).unwrap();

        assert_eq!(parsed_headers.get("Path"), Some(&"audio".to_string()));
        assert_eq!(
            parsed_headers.get("Content-Type"),
            Some(&"audio/mpeg".to_string())
        );
        assert_eq!(payload, b"abc123");
    }

    #[test]
    fn test_parse_binary_message_rejects_truncated_frame() {
        let frame = [0x00, 0x08, b'P', b'a', b't'];
        assert!(parse_binary_message(&frame).is_none());
    }

    #[test]
    fn test_parse_header_string_ignores_invalid_lines() {
        let headers = parse_header_string("Path:audio\r\ninvalid\r\nX-RequestId:abc");

        assert_eq!(headers.get("Path"), Some(&"audio".to_string()));
        assert_eq!(headers.get("X-RequestId"), Some(&"abc".to_string()));
        assert_eq!(headers.len(), 2);
    }

    #[test]
    fn test_build_websocket_url_contains_required_query_parameters() {
        let url = build_websocket_url("wss://example.com/edge/v1").unwrap();

        assert!(url.contains("TrustedClientToken="));
        assert!(url.contains("Sec-MS-GEC="));
        assert!(url.contains("Sec-MS-GEC-Version="));
        assert!(url.contains("ConnectionId="));
    }

    #[test]
    fn test_build_ssml_message_uses_pre_escaped_chunk_text() {
        let escaped_chunk = &split_text_by_byte_length("A & B < C > D")[0];
        let message = build_ssml_message("req", escaped_chunk, &TTSConfig::default());

        assert!(message.contains("A &amp; B &lt; C &gt; D"));
        assert!(!message.contains("&amp;amp;"));
        assert!(!message.contains("&amp;lt;"));
        assert!(!message.contains("&amp;gt;"));
    }

    #[tokio::test]
    async fn test_stream_audio_rejects_empty_text() {
        let (_cancel_tx, cancel_rx) = watch::channel(false);
        let communicate = Communicate::new(String::new(), TTSConfig::default(), cancel_rx);

        let error = communicate.stream_audio().await.unwrap_err();

        assert!(matches!(error, EdgeTTSError::NoAudioReceived));
    }

    #[tokio::test]
    async fn test_stream_audio_honors_preemptive_cancellation() {
        let (cancel_tx, cancel_rx) = watch::channel(false);
        cancel_tx.send(true).unwrap();
        let communicate =
            Communicate::new("hello world".to_string(), TTSConfig::default(), cancel_rx);

        let error = communicate.stream_audio().await.unwrap_err();

        assert!(matches!(error, EdgeTTSError::Cancelled));
    }

    #[tokio::test]
    async fn test_connect_websocket_returns_timeout_when_handshake_stalls() {
        let base_url = spawn_stalled_tcp_server().await;
        let (_cancel_tx, cancel_rx) = watch::channel(false);
        let communicate =
            Communicate::new("hello world".to_string(), TTSConfig::default(), cancel_rx);

        let error = communicate
            .connect_websocket_with_timeout(&base_url, Duration::from_millis(50))
            .await
            .unwrap_err();

        match error {
            EdgeTTSError::ConnectionError(message) => {
                assert!(message.to_lowercase().contains("timeout"));
            }
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[tokio::test]
    async fn test_stream_audio_returns_timeout_when_server_stalls() {
        let base_url = spawn_silent_websocket_server().await;
        let (_cancel_tx, cancel_rx) = watch::channel(false);
        let communicate =
            Communicate::new("hello world".to_string(), TTSConfig::default(), cancel_rx);

        let error = communicate
            .stream_audio_with_timeout(&base_url, Duration::from_millis(50))
            .await
            .unwrap_err();

        match error {
            EdgeTTSError::WebSocketError(message) => {
                assert!(message.to_lowercase().contains("timeout"));
            }
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[tokio::test]
    async fn test_stream_audio_reports_progress_and_concatenates_all_chunks() {
        let text = "你好 ".repeat(1500);
        let chunks = split_text_by_byte_length(&text);
        assert!(chunks.len() > 1);

        let payloads: Vec<Vec<u8>> = (0..chunks.len())
            .map(|index| format!("chunk-{index}").into_bytes())
            .collect();
        let expected_audio: Vec<u8> = payloads.concat();
        let connection_count = Arc::new(AtomicUsize::new(0));
        let base_url = spawn_chunked_audio_server(payloads, Arc::clone(&connection_count)).await;
        let (_cancel_tx, cancel_rx) = watch::channel(false);
        let progress = Arc::new(std::sync::Mutex::new(Vec::<(usize, usize)>::new()));
        let progress_for_callback = Arc::clone(&progress);
        let communicate = Communicate::new(text, TTSConfig::default(), cancel_rx).with_progress(
            move |completed, total| {
                progress_for_callback
                    .lock()
                    .unwrap()
                    .push((completed, total));
            },
        );

        let audio = communicate
            .stream_audio_with_timeout(&base_url, RECEIVE_TIMEOUT)
            .await
            .unwrap();

        assert_eq!(audio, expected_audio);
        assert_eq!(connection_count.load(Ordering::SeqCst), chunks.len());
        let events = progress.lock().unwrap();
        assert_eq!(events.len(), chunks.len());
        assert_eq!(events.last().copied(), Some((chunks.len(), chunks.len())));
    }

    #[tokio::test]
    async fn test_stream_audio_synthesizes_chunks_concurrently_and_preserves_order() {
        let text = "concurrent sentence ".repeat(900);
        let chunks = split_text_by_byte_length(&text);
        assert!(chunks.len() >= 4);

        let concurrency = chunks.len().min(4);
        let base_url = spawn_barrier_audio_server(concurrency).await;
        let (_cancel_tx, cancel_rx) = watch::channel(false);
        let communicate = Communicate::new(text, TTSConfig::default(), cancel_rx)
            .with_chunk_concurrency(concurrency);

        let audio = tokio::time::timeout(
            Duration::from_secs(10),
            communicate.stream_audio_with_timeout(&base_url, RECEIVE_TIMEOUT),
        )
        .await
        .expect("chunks were not synthesized concurrently")
        .unwrap();

        let expected: Vec<u8> = chunks
            .iter()
            .flat_map(|chunk| chunk.as_bytes().to_vec())
            .collect();
        assert_eq!(audio, expected, "audio must stay in text order");
    }

    async fn spawn_stalled_tcp_server() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();

        tokio::spawn(async move {
            let (_stream, _) = listener.accept().await.unwrap();
            sleep(Duration::from_millis(300)).await;
        });

        format!("ws://{address}/edge/v1")
    }

    async fn spawn_silent_websocket_server() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();

        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut websocket = accept_async(stream).await.unwrap();
            let _ = websocket.next().await;
            let _ = websocket.next().await;
            sleep(Duration::from_millis(300)).await;
        });

        format!("ws://{address}/edge/v1")
    }

    #[allow(dead_code)]
    async fn spawn_unknown_path_websocket_server(path: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();

        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut websocket = accept_async(stream).await.unwrap();
            let _ = websocket.next().await;
            let _ = websocket.next().await;
            websocket
                .send(Message::Text(format!("Path:{path}\r\n\r\n").into()))
                .await
                .unwrap();
            websocket.close(None).await.unwrap();
        });

        format!("ws://{address}/edge/v1")
    }

    /// First `expected_concurrent` connections must arrive before any of them
    /// replies. A sequential implementation therefore times out instead of
    /// producing a false positive.
    async fn spawn_barrier_audio_server(expected_concurrent: usize) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let barrier = Arc::new(tokio::sync::Barrier::new(expected_concurrent));
        let arrived = Arc::new(AtomicUsize::new(0));

        tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    break;
                };
                let barrier = Arc::clone(&barrier);
                let arrived = Arc::clone(&arrived);

                tokio::spawn(async move {
                    let Ok(mut websocket) = accept_async(stream).await else {
                        return;
                    };
                    let _ = websocket.next().await;
                    let Some(Ok(ssml)) = websocket.next().await else {
                        return;
                    };
                    let payload = extract_ssml_text(&ssml);

                    if arrived.fetch_add(1, Ordering::SeqCst) < expected_concurrent {
                        barrier.wait().await;
                    }

                    let headers = b"Path:audio\r\nContent-Type:audio/mpeg";
                    let mut frame = Vec::new();
                    frame.extend_from_slice(&(headers.len() as u16).to_be_bytes());
                    frame.extend_from_slice(headers);
                    frame.extend_from_slice(&payload);

                    let _ = websocket.send(Message::Binary(frame.into())).await;
                    let _ = websocket
                        .send(Message::Text("Path:turn.end\r\n\r\n".into()))
                        .await;
                    let _ = websocket.close(None).await;
                });
            }
        });

        format!("ws://{address}/edge/v1")
    }

    fn extract_ssml_text(message: &Message) -> Vec<u8> {
        let Message::Text(text) = message else {
            return Vec::new();
        };

        let Some(prosody_start) = text.find("<prosody") else {
            return Vec::new();
        };
        let Some(open_end) = text[prosody_start..].find('>') else {
            return Vec::new();
        };
        let content_start = prosody_start + open_end + 1;
        let Some(content_end) = text[content_start..].find("</prosody>") else {
            return Vec::new();
        };

        text[content_start..content_start + content_end]
            .as_bytes()
            .to_vec()
    }

    async fn spawn_chunked_audio_server(
        payloads: Vec<Vec<u8>>,
        connection_count: Arc<AtomicUsize>,
    ) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();

        tokio::spawn(async move {
            for payload in payloads {
                let (stream, _) = listener.accept().await.unwrap();
                connection_count.fetch_add(1, Ordering::SeqCst);
                let mut websocket = accept_async(stream).await.unwrap();
                let _ = websocket.next().await;
                let _ = websocket.next().await;

                let headers = b"Path:audio\r\nContent-Type:audio/mpeg";
                let mut frame = Vec::new();
                frame.extend_from_slice(&(headers.len() as u16).to_be_bytes());
                frame.extend_from_slice(headers);
                frame.extend_from_slice(&payload);

                websocket.send(Message::Binary(frame.into())).await.unwrap();
                websocket
                    .send(Message::Text("Path:turn.end\r\n\r\n".into()))
                    .await
                    .unwrap();
                websocket.close(None).await.unwrap();
            }
        });

        format!("ws://{address}/edge/v1")
    }
}
