use std::future::Future;
use std::time::Duration;

use tokio::sync::watch;
use tokio::time::sleep;

/// Hard ceiling for a single backoff wait. Without it the exponential delay for
/// the maximum retry count (10) would reach 512 seconds per attempt, and the
/// UI "stop" button would not be able to interrupt the wait.
const MAX_BACKOFF_MS: u64 = 10_000;

/// Why a retry loop stopped without a value.
#[derive(Debug)]
pub enum RetryOutcome<E> {
    /// The operation failed and must not (or can no longer) be retried.
    Failed(E),
    /// Cancellation was requested while waiting between attempts.
    Cancelled,
}

/// Runs `operation` with capped exponential backoff.
///
/// - `is_retryable` classifies the error; permanent failures return immediately.
/// - `cancel_rx` aborts the wait between attempts as soon as it flips to `true`,
///   so stopping a conversion never has to wait out a backoff sleep.
pub async fn retry_with_backoff<T, E, F, Fut, P>(
    max_retries: u32,
    base_delay_ms: u64,
    mut cancel_rx: watch::Receiver<bool>,
    is_retryable: P,
    mut operation: F,
) -> Result<T, RetryOutcome<E>>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, E>>,
    P: Fn(&E) -> bool,
    E: std::fmt::Display,
{
    let mut attempt = 0_u32;

    loop {
        if *cancel_rx.borrow() {
            return Err(RetryOutcome::Cancelled);
        }

        match operation().await {
            Ok(value) => return Ok(value),
            Err(error) => {
                let retryable = is_retryable(&error);
                if !retryable || attempt >= max_retries {
                    return Err(RetryOutcome::Failed(error));
                }

                let delay = backoff_delay(base_delay_ms, attempt);
                log::warn!(
                    "Attempt {}/{} failed: {}. Retrying in {}ms...",
                    u64::from(attempt) + 1,
                    u64::from(max_retries) + 1,
                    error,
                    delay
                );

                if wait_or_cancel(&mut cancel_rx, delay).await {
                    return Err(RetryOutcome::Cancelled);
                }

                attempt += 1;
            }
        }
    }
}

/// `base * 2^attempt`, capped so the user never waits minutes for a retry.
fn backoff_delay(base_delay_ms: u64, attempt: u32) -> u64 {
    let multiplier = 1_u64.checked_shl(attempt.min(31)).unwrap_or(u64::MAX);
    base_delay_ms.saturating_mul(multiplier).min(MAX_BACKOFF_MS)
}

/// Returns `true` when cancellation was observed during the wait.
async fn wait_or_cancel(cancel_rx: &mut watch::Receiver<bool>, delay_ms: u64) -> bool {
    if delay_ms == 0 {
        return *cancel_rx.borrow();
    }

    tokio::select! {
        _ = sleep(Duration::from_millis(delay_ms)) => *cancel_rx.borrow(),
        changed = cancel_rx.changed() => changed.is_err() || *cancel_rx.borrow(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    fn retryable<E>(_: &E) -> bool {
        true
    }

    fn always_cancel_channel() -> (watch::Sender<bool>, watch::Receiver<bool>) {
        watch::channel(false)
    }

    #[tokio::test]
    async fn test_retry_succeeds_first_try() {
        let (_cancel_tx, cancel_rx) = always_cancel_channel();
        let result: Result<i32, RetryOutcome<String>> =
            retry_with_backoff(3, 10, cancel_rx, retryable, || async { Ok(42) }).await;
        assert_eq!(result.unwrap(), 42);
    }

    #[tokio::test]
    async fn test_retry_succeeds_after_failures() {
        let count = Arc::new(AtomicU32::new(0));
        let count_clone = count.clone();
        let (_cancel_tx, cancel_rx) = always_cancel_channel();

        let result: Result<i32, RetryOutcome<String>> =
            retry_with_backoff(3, 1, cancel_rx, retryable, move || {
                let c = count_clone.clone();
                async move {
                    let n = c.fetch_add(1, Ordering::SeqCst);
                    if n < 2 {
                        Err(format!("fail {}", n))
                    } else {
                        Ok(42)
                    }
                }
            })
            .await;

        assert_eq!(result.unwrap(), 42);
        assert_eq!(count.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn test_retry_exhausted() {
        let (_cancel_tx, cancel_rx) = always_cancel_channel();
        let result: Result<i32, RetryOutcome<String>> =
            retry_with_backoff(2, 1, cancel_rx, retryable, || async {
                Err("always fails".to_string())
            })
            .await;
        assert!(matches!(result, Err(RetryOutcome::Failed(message)) if message == "always fails"));
    }

    #[tokio::test]
    async fn test_retry_does_not_retry_permanent_errors() {
        let attempts = Arc::new(AtomicU32::new(0));
        let attempts_clone = attempts.clone();
        let (_cancel_tx, cancel_rx) = always_cancel_channel();

        let result: Result<(), RetryOutcome<String>> = retry_with_backoff(
            9,
            1,
            cancel_rx,
            |error: &String| !error.contains("permanent"),
            move || {
                let attempts = attempts_clone.clone();
                async move {
                    attempts.fetch_add(1, Ordering::SeqCst);
                    Err("permanent failure".to_string())
                }
            },
        )
        .await;

        assert!(matches!(result, Err(RetryOutcome::Failed(_))));
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn test_retry_cancels_during_backoff_without_waiting() {
        let (cancel_tx, cancel_rx) = watch::channel(false);
        let cancel_task = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(20)).await;
            let _ = cancel_tx.send(true);
        });

        let result: Result<(), RetryOutcome<String>> = tokio::time::timeout(
            Duration::from_secs(5),
            retry_with_backoff(9, MAX_BACKOFF_MS, cancel_rx, retryable, || async {
                Err("transient".to_string())
            }),
        )
        .await
        .expect("cancellation must interrupt the backoff sleep");

        cancel_task.await.unwrap();
        assert!(matches!(result, Err(RetryOutcome::Cancelled)));
    }

    #[tokio::test]
    async fn test_retry_returns_cancelled_without_starting_when_preexisting_cancel() {
        let (cancel_tx, cancel_rx) = watch::channel(false);
        cancel_tx.send(true).unwrap();
        let attempts = Arc::new(AtomicU32::new(0));
        let attempts_clone = attempts.clone();

        let result: Result<(), RetryOutcome<String>> =
            retry_with_backoff(3, 1, cancel_rx, retryable, move || {
                let attempts = attempts_clone.clone();
                async move {
                    attempts.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                }
            })
            .await;

        assert!(matches!(result, Err(RetryOutcome::Cancelled)));
        assert_eq!(attempts.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn test_backoff_delay_grows_then_caps() {
        assert_eq!(backoff_delay(1_000, 0), 1_000);
        assert_eq!(backoff_delay(1_000, 1), 2_000);
        assert_eq!(backoff_delay(1_000, 2), 4_000);
        assert_eq!(backoff_delay(1_000, 3), 8_000);
        assert_eq!(backoff_delay(1_000, 4), MAX_BACKOFF_MS);
        assert_eq!(backoff_delay(1_000, 30), MAX_BACKOFF_MS);
        assert_eq!(backoff_delay(u64::MAX, 30), MAX_BACKOFF_MS);
    }
}
