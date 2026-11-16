use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, LazyLock};

use tauri::{command, AppHandle, Emitter};
use tokio::sync::{watch, Mutex};

use crate::commands::error::CommandError;
use crate::edge_tts::constants::DEFAULT_OUTPUT_FORMAT;
use crate::edge_tts::errors::EdgeTTSError;
use crate::edge_tts::types::TTSConfig;
use crate::edge_tts::Communicate;
use crate::utils::retry::{retry_with_backoff, RetryOutcome};

const PROGRESS_EVENT: &str = "tts://progress";

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsProgressEvent {
    pub task_id: String,
    pub completed: usize,
    pub total: usize,
}

type ActiveTaskMap = Arc<Mutex<HashMap<String, watch::Sender<bool>>>>;

static ACTIVE_TASKS: LazyLock<ActiveTaskMap> =
    LazyLock::new(|| Arc::new(Mutex::new(HashMap::new())));

#[derive(serde::Deserialize)]
pub struct TtsConvertParams {
    pub text: String,
    pub voice: String,
    pub rate: String,
    pub pitch: String,
    pub volume: String,
    #[serde(default = "default_format")]
    pub format: String,
    pub task_id: String,
    #[serde(default = "default_retries")]
    pub max_retries: u32,
    /// Number of text chunks synthesized in parallel; clamped in `Communicate`.
    #[serde(default = "default_chunk_concurrency")]
    pub chunk_concurrency: usize,
}

fn default_format() -> String {
    DEFAULT_OUTPUT_FORMAT.to_string()
}

fn default_retries() -> u32 {
    3
}

fn default_chunk_concurrency() -> usize {
    1
}

#[command]
pub async fn tts_convert(
    app: AppHandle,
    params: TtsConvertParams,
) -> Result<tauri::ipc::Response, CommandError> {
    let task_id = params.task_id.clone();
    let on_progress = move |completed: usize, total: usize| {
        let _ = app.emit(
            PROGRESS_EVENT,
            TtsProgressEvent {
                task_id: task_id.clone(),
                completed,
                total,
            },
        );
    };

    let audio = synthesize(params, on_progress).await?;
    // Raw IPC body instead of a JSON number array: a 1 MB MP3 otherwise
    // expands to roughly 3-4 MB of JSON text on every conversion.
    Ok(tauri::ipc::Response::new(audio))
}

async fn synthesize<F>(params: TtsConvertParams, on_progress: F) -> Result<Vec<u8>, EdgeTTSError>
where
    F: Fn(usize, usize) + Send + Sync + Clone + 'static,
{
    let chunk_concurrency = params.chunk_concurrency;
    run_tts_convert(params, 1000, move |text, config, cancel_rx| {
        let on_progress = on_progress.clone();
        async move {
            Communicate::new(text, config, cancel_rx)
                .with_chunk_concurrency(chunk_concurrency)
                .with_progress(on_progress)
                .stream_audio()
                .await
        }
    })
    .await
}

async fn run_tts_convert<R, Fut>(
    params: TtsConvertParams,
    base_delay_ms: u64,
    run_stream: R,
) -> Result<Vec<u8>, EdgeTTSError>
where
    R: Fn(String, TTSConfig, watch::Receiver<bool>) -> Fut + Clone,
    Fut: Future<Output = Result<Vec<u8>, EdgeTTSError>>,
{
    let (cancel_tx, cancel_rx) = watch::channel(false);
    let task_id = params.task_id;

    {
        let mut tasks = ACTIVE_TASKS.lock().await;
        if tasks.contains_key(&task_id) {
            return Err(EdgeTTSError::TaskAlreadyExists(task_id));
        }
        tasks.insert(task_id.clone(), cancel_tx);
    }

    let config = TTSConfig {
        voice: params.voice,
        rate: params.rate,
        pitch: params.pitch,
        volume: params.volume,
        output_format: params.format,
    };

    let text = params.text;
    let retry_cancel = cancel_rx.clone();
    let result = retry_with_backoff(
        params.max_retries,
        base_delay_ms,
        retry_cancel,
        |error: &EdgeTTSError| error.retryable(),
        || {
            let text = text.clone();
            let config = config.clone();
            let cancel_rx = cancel_rx.clone();
            let run_stream = run_stream.clone();
            async move { run_stream(text, config, cancel_rx).await }
        },
    )
    .await;

    ACTIVE_TASKS.lock().await.remove(&task_id);

    match result {
        Ok(audio) => Ok(audio),
        Err(RetryOutcome::Failed(error)) => Err(error),
        Err(RetryOutcome::Cancelled) => Err(EdgeTTSError::Cancelled),
    }
}

#[command]
pub async fn tts_stop(task_id: String) -> Result<(), CommandError> {
    let tasks = ACTIVE_TASKS.lock().await;
    if let Some(cancel_tx) = tasks.get(&task_id) {
        cancel_tx
            .send(true)
            .map_err(|error| CommandError::new("unknown", error.to_string(), false))
    } else {
        Err(CommandError::from(EdgeTTSError::TaskNotFound(task_id)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    static TEST_MUTEX: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    #[tokio::test]
    async fn test_run_tts_convert_registers_task_retries_and_unregisters_on_success() {
        let _guard = TEST_MUTEX.lock().await;
        clear_active_tasks().await;
        let attempts = Arc::new(AtomicUsize::new(0));
        let params = TtsConvertParams {
            text: "hello".to_string(),
            voice: "en-US-TestNeural".to_string(),
            rate: "+10%".to_string(),
            pitch: "+5Hz".to_string(),
            volume: "+20%".to_string(),
            format: "audio-test-format".to_string(),
            task_id: "task-1".to_string(),
            max_retries: 1,
            chunk_concurrency: 1,
        };

        let result = run_tts_convert(params, 0, {
            let attempts = Arc::clone(&attempts);
            move |text, config, cancel_rx| {
                let attempts = Arc::clone(&attempts);
                async move {
                    assert_eq!(text, "hello");
                    assert_eq!(config.voice, "en-US-TestNeural");
                    assert_eq!(config.rate, "+10%");
                    assert_eq!(config.pitch, "+5Hz");
                    assert_eq!(config.volume, "+20%");
                    assert_eq!(config.output_format, "audio-test-format");
                    assert!(!*cancel_rx.borrow());
                    assert!(ACTIVE_TASKS.lock().await.contains_key("task-1"));

                    let attempt = attempts.fetch_add(1, Ordering::SeqCst);
                    if attempt == 0 {
                        Err(EdgeTTSError::WebSocketError("retry".to_string()))
                    } else {
                        Ok(vec![1, 2, 3])
                    }
                }
            }
        })
        .await;

        assert_eq!(result.unwrap(), vec![1, 2, 3]);
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
        assert!(ACTIVE_TASKS.lock().await.is_empty());
    }

    #[tokio::test]
    async fn test_run_tts_convert_unregisters_task_on_error() {
        let _guard = TEST_MUTEX.lock().await;
        clear_active_tasks().await;
        let params = TtsConvertParams {
            text: "hello".to_string(),
            voice: "en-US-TestNeural".to_string(),
            rate: "+0%".to_string(),
            pitch: "+0Hz".to_string(),
            volume: "+0%".to_string(),
            format: "audio-test-format".to_string(),
            task_id: "task-error".to_string(),
            max_retries: 1,
            chunk_concurrency: 1,
        };

        let error = run_tts_convert(params, 0, |_, _, _| async {
            Err(EdgeTTSError::WebSocketError("always fails".to_string()))
        })
        .await
        .unwrap_err();

        assert!(error.to_string().contains("always fails"));
        assert!(ACTIVE_TASKS.lock().await.is_empty());
    }

    #[tokio::test]
    async fn test_run_tts_convert_does_not_retry_cancelled() {
        let _guard = TEST_MUTEX.lock().await;
        clear_active_tasks().await;
        let attempts = Arc::new(AtomicUsize::new(0));
        let params = TtsConvertParams {
            text: "hello".to_string(),
            voice: "en-US-TestNeural".to_string(),
            rate: "+0%".to_string(),
            pitch: "+0Hz".to_string(),
            volume: "+0%".to_string(),
            format: "audio-test-format".to_string(),
            task_id: "task-cancelled".to_string(),
            max_retries: 3,
            chunk_concurrency: 1,
        };

        let error = run_tts_convert(params, 0, {
            let attempts = Arc::clone(&attempts);
            move |_, _, _| {
                let attempts = Arc::clone(&attempts);
                async move {
                    attempts.fetch_add(1, Ordering::SeqCst);
                    Err(EdgeTTSError::Cancelled)
                }
            }
        })
        .await
        .unwrap_err();

        assert!(matches!(error, EdgeTTSError::Cancelled));
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
        assert!(ACTIVE_TASKS.lock().await.is_empty());
    }

    #[tokio::test]
    async fn test_run_tts_convert_does_not_retry_auth_errors() {
        let _guard = TEST_MUTEX.lock().await;
        clear_active_tasks().await;
        let attempts = Arc::new(AtomicUsize::new(0));
        let params = TtsConvertParams {
            text: "hello".to_string(),
            voice: "en-US-TestNeural".to_string(),
            rate: "+0%".to_string(),
            pitch: "+0Hz".to_string(),
            volume: "+0%".to_string(),
            format: "audio-test-format".to_string(),
            task_id: "task-forbidden".to_string(),
            max_retries: 5,
            chunk_concurrency: 1,
        };

        let error = run_tts_convert(params, 0, {
            let attempts = Arc::clone(&attempts);
            move |_, _, _| {
                let attempts = Arc::clone(&attempts);
                async move {
                    attempts.fetch_add(1, Ordering::SeqCst);
                    Err(EdgeTTSError::HttpError(403))
                }
            }
        })
        .await
        .unwrap_err();

        assert_eq!(error.code(), "auth");
        assert!(error.to_string().contains("403"));
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
        assert!(ACTIVE_TASKS.lock().await.is_empty());
    }

    #[tokio::test]
    async fn test_run_tts_convert_rejects_duplicate_task_id() {
        let _guard = TEST_MUTEX.lock().await;
        clear_active_tasks().await;
        let (cancel_tx, _cancel_rx) = watch::channel(false);
        ACTIVE_TASKS
            .lock()
            .await
            .insert("task-duplicate".to_string(), cancel_tx);
        let params = TtsConvertParams {
            text: "hello".to_string(),
            voice: "en-US-TestNeural".to_string(),
            rate: "+0%".to_string(),
            pitch: "+0Hz".to_string(),
            volume: "+0%".to_string(),
            format: "audio-test-format".to_string(),
            task_id: "task-duplicate".to_string(),
            max_retries: 1,
            chunk_concurrency: 1,
        };

        let error = run_tts_convert(params, 0, |_, _, _| async { Ok(vec![1]) })
            .await
            .unwrap_err();

        assert!(matches!(error, EdgeTTSError::TaskAlreadyExists(_)));
        assert!(ACTIVE_TASKS.lock().await.contains_key("task-duplicate"));
        clear_active_tasks().await;
    }

    #[tokio::test]
    async fn test_tts_stop_signals_existing_task() {
        let _guard = TEST_MUTEX.lock().await;
        clear_active_tasks().await;
        let (cancel_tx, mut cancel_rx) = watch::channel(false);
        ACTIVE_TASKS
            .lock()
            .await
            .insert("task-1".to_string(), cancel_tx);

        tts_stop("task-1".to_string()).await.unwrap();

        tokio::time::timeout(Duration::from_secs(1), cancel_rx.changed())
            .await
            .unwrap()
            .unwrap();
        assert!(*cancel_rx.borrow());
        clear_active_tasks().await;
    }

    #[tokio::test]
    async fn test_tts_stop_returns_error_for_unknown_task() {
        let _guard = TEST_MUTEX.lock().await;
        clear_active_tasks().await;

        let error = tts_stop("missing-task".to_string()).await.unwrap_err();

        assert_eq!(error.code, "unknown");
        assert!(error.message.contains("not found"));
    }

    /// Live probe: `cargo test --lib live_ -- --ignored --nocapture`
    /// Writes the synthesized audio to `.workbuddy/tmp/live_tts_probe.mp3`.
    #[tokio::test]
    #[ignore = "live network probe: synthesizes real audio via Microsoft Edge TTS"]
    async fn live_tts_convert_produces_playable_mp3() {
        use uuid::Uuid;

        let params = TtsConvertParams {
            text: "这是一次真实的语音合成测试，用于验证修复后的接口连通性。".to_string(),
            voice: "zh-CN-XiaoxiaoNeural".to_string(),
            rate: "+0%".to_string(),
            pitch: "+0Hz".to_string(),
            volume: "+0%".to_string(),
            format: "audio-24khz-48kbitrate-mono-mp3".to_string(),
            task_id: format!("live-probe-{}", Uuid::new_v4()),
            max_retries: 1,
            chunk_concurrency: 1,
        };

        let audio = synthesize(params, |_: usize, _: usize| {})
            .await
            .expect("live synthesis failed");

        assert!(audio.len() > 4096, "audio too small: {} bytes", audio.len());
        assert_eq!(audio[0], 0xFF, "missing MP3 frame sync byte");
        assert_eq!(audio[1] & 0xE0, 0xE0, "invalid MP3 frame header");

        let output = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../.workbuddy/tmp/live_tts_probe.mp3");
        std::fs::create_dir_all(output.parent().unwrap()).unwrap();
        std::fs::write(&output, &audio).unwrap();

        println!("LIVE AUDIO: {} bytes -> {}", audio.len(), output.display());
    }

    async fn clear_active_tasks() {
        ACTIVE_TASKS.lock().await.clear();
    }
}
