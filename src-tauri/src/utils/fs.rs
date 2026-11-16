use std::path::{Path, PathBuf};

/// Temporary sibling used to build `target` atomically.
///
/// The real extension is preserved, because ffmpeg infers its output muxer from
/// the file name.
pub fn partial_path(target: &Path) -> PathBuf {
    let stem = target
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("output");

    match target.extension().and_then(|value| value.to_str()) {
        Some(extension) if !extension.is_empty() => {
            target.with_file_name(format!(".{stem}.part.{extension}"))
        }
        _ => target.with_file_name(format!(".{stem}.part")),
    }
}

/// Moves a fully written temporary file onto its final path.
pub async fn replace_file(temp: &Path, target: &Path) -> Result<(), String> {
    match tokio::fs::rename(temp, target).await {
        Ok(()) => Ok(()),
        Err(first_error) => {
            // Windows refuses to rename over an existing file.
            if !target.exists() {
                return Err(format!(
                    "Failed to finalize {}: {first_error}",
                    target.display()
                ));
            }

            tokio::fs::remove_file(target)
                .await
                .map_err(|error| format!("Failed to replace {}: {error}", target.display()))?;
            tokio::fs::rename(temp, target)
                .await
                .map_err(|error| format!("Failed to finalize {}: {error}", target.display()))
        }
    }
}

/// Writes `bytes` to `target` through a temporary sibling, so a failed or
/// interrupted write never leaves a truncated audio file behind.
pub async fn write_file_atomically(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let temp = partial_path(target);

    tokio::fs::write(&temp, bytes)
        .await
        .map_err(|error| format!("Failed to write file: {error}"))?;

    if let Err(error) = replace_file(&temp, target).await {
        let _ = tokio::fs::remove_file(&temp).await;
        return Err(error);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_path(extension: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "tts-vue-next-{}.{}",
            uuid::Uuid::new_v4(),
            extension
        ))
    }

    #[test]
    fn test_partial_path_preserves_extension() {
        let path = Path::new("audio/output.wav");

        assert_eq!(partial_path(path), Path::new("audio/.output.part.wav"));
    }

    #[tokio::test]
    async fn test_write_file_atomically_replaces_existing_file_and_leaves_no_partial() {
        let target = unique_path("mp3");
        tokio::fs::write(&target, b"old").await.unwrap();

        write_file_atomically(&target, b"new").await.unwrap();

        assert_eq!(tokio::fs::read(&target).await.unwrap(), b"new");
        let partial = partial_path(&target);
        assert!(!partial.exists(), "partial file must not survive");

        let _ = tokio::fs::remove_file(target).await;
    }

    #[tokio::test]
    async fn test_replace_file_reports_missing_target_directory() {
        let temp = unique_path("mp3");
        tokio::fs::write(&temp, b"data").await.unwrap();
        let missing_target = std::env::temp_dir()
            .join(format!("tts-vue-next-missing-{}", uuid::Uuid::new_v4()))
            .join("out.mp3");

        let error = replace_file(&temp, &missing_target).await.unwrap_err();

        assert!(error.contains("Failed to finalize"));
        let _ = tokio::fs::remove_file(temp).await;
    }
}
