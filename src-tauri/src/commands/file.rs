use std::path::Path;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use pulldown_cmark::{Event, Parser, Tag, TagEnd};
use tauri::command;
use tauri_plugin_dialog::DialogExt;

use crate::utils::fs::write_file_atomically;

const ALLOWED_OUTPUT_EXTENSIONS: [&str; 4] = ["mp3", "wav", "ogg", "flac"];
const CONFLICT_STRATEGIES: [&str; 3] = ["overwrite", "skip", "rename"];
const MAX_CONFLICT_SUFFIX: u32 = 1000;

#[command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("Path not found: {path}"));
    }
    if !file_path.is_file() {
        return Err("Path is not a file".to_string());
    }

    let Some(extension) = file_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
    else {
        return Err("File has no extension".to_string());
    };

    match extension.as_str() {
        "txt" => tokio::fs::read_to_string(&path)
            .await
            .map_err(|error| format!("Failed to read txt file: {error}")),
        "md" | "markdown" => {
            let markdown = tokio::fs::read_to_string(&path)
                .await
                .map_err(|error| format!("Failed to read markdown file: {error}"))?;
            Ok(strip_markdown(&markdown))
        }
        "docx" => read_docx(&path).map_err(|error| format!("Failed to read docx file: {error}")),
        other => Err(format!("Unsupported file type: .{other}")),
    }
}

#[command]
pub async fn select_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(map_selected_folder(
        app.dialog().file().blocking_pick_folder(),
    ))
}

#[command]
pub async fn show_in_folder(path: String) -> Result<(), String> {
    let target_path = Path::new(&path);
    if !target_path.exists() {
        return Err(format!("Path not found: {path}"));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|error| error.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|error| error.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        let parent = target_path.parent().unwrap_or(Path::new("/"));
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

/// Audio bytes arrive as base64: a JSON number array would inflate a 1 MB MP3
/// to roughly 3-4 MB of IPC payload on the write path.
#[command]
pub async fn write_binary_file(path: String, data: String) -> Result<(), String> {
    validate_audio_output_path(&path)?;

    let bytes = STANDARD
        .decode(data.as_bytes())
        .map_err(|error| format!("Invalid base64 audio data: {error}"))?;

    write_file_atomically(Path::new(&path), &bytes).await
}

/// Decides what the batch queue should do when the target file already exists.
///
/// Returns `None` when the caller should skip the file entirely.
#[command]
pub async fn resolve_output_path(path: String, strategy: String) -> Result<Option<String>, String> {
    validate_audio_output_path(&path)?;

    if !CONFLICT_STRATEGIES.contains(&strategy.as_str()) {
        return Err(format!("Unsupported conflict strategy: {strategy}"));
    }

    if !Path::new(&path).exists() {
        return Ok(Some(path));
    }

    match strategy.as_str() {
        "overwrite" => Ok(Some(path)),
        "skip" => Ok(None),
        _ => renamed_output_path(&path).map(Some),
    }
}

fn renamed_output_path(path: &str) -> Result<String, String> {
    let file_path = Path::new(path);
    let parent = file_path
        .parent()
        .ok_or_else(|| "Output file must include a parent directory".to_string())?;
    let stem = file_path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Output file name is invalid".to_string())?;
    let extension = file_path
        .extension()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Output file must have an audio extension".to_string())?;

    for index in 1..=MAX_CONFLICT_SUFFIX {
        let candidate = parent.join(format!("{stem} ({index}).{extension}"));
        if !candidate.exists() {
            return Ok(candidate.to_string_lossy().into_owned());
        }
    }

    Err(format!("Too many files with the same name: {path}"))
}

#[command]
pub async fn remove_file(path: String) -> Result<(), String> {
    validate_temporary_audio_path(&path)?;

    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("Path not found: {path}"));
    }
    if !file_path.is_file() {
        return Err("Path is not a file".to_string());
    }

    tokio::fs::remove_file(&path)
        .await
        .map_err(|error| format!("Failed to remove file: {error}"))
}

fn validate_audio_output_path(path: &str) -> Result<(), String> {
    let file_path = Path::new(path);
    let Some(file_name) = file_path.file_name().and_then(|value| value.to_str()) else {
        return Err("Output file name is invalid".to_string());
    };
    if file_name.is_empty() {
        return Err("Output file name is invalid".to_string());
    }

    let Some(parent) = file_path.parent() else {
        return Err("Output file must include a parent directory".to_string());
    };
    if !parent.exists() {
        return Err(format!("Output directory not found: {}", parent.display()));
    }
    if !parent.is_dir() {
        return Err("Output parent path is not a directory".to_string());
    }

    let Some(extension) = file_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
    else {
        return Err("Output file must have an audio extension".to_string());
    };

    if !ALLOWED_OUTPUT_EXTENSIONS.contains(&extension.as_str()) {
        return Err(format!("Unsupported output file type: .{extension}"));
    }

    Ok(())
}

fn validate_temporary_audio_path(path: &str) -> Result<(), String> {
    validate_audio_output_path(path)?;

    let file_path = Path::new(path);
    let Some(file_name) = file_path.file_name().and_then(|value| value.to_str()) else {
        return Err("Temporary audio file name is invalid".to_string());
    };

    if !file_name.to_ascii_lowercase().ends_with(".tmp.mp3") {
        return Err("Only temporary audio files can be removed".to_string());
    }

    Ok(())
}

fn map_selected_folder(path: Option<tauri_plugin_dialog::FilePath>) -> Option<String> {
    path.map(|value| value.to_string())
}

fn strip_markdown(markdown: &str) -> String {
    let parser = Parser::new(markdown);
    let mut text = String::new();
    let mut in_code_block = false;

    for event in parser {
        match event {
            Event::Text(value) => {
                if !in_code_block {
                    text.push_str(&value);
                }
            }
            Event::SoftBreak | Event::HardBreak => {
                if !text.ends_with('\n') {
                    text.push('\n');
                }
            }
            Event::End(TagEnd::Paragraph) => {
                if !text.ends_with("\n\n") {
                    text.push_str("\n\n");
                }
            }
            Event::Start(Tag::CodeBlock(_)) => {
                in_code_block = true;
            }
            Event::End(TagEnd::CodeBlock) => {
                in_code_block = false;
            }
            _ => {}
        }
    }

    text.trim().to_string()
}

fn read_docx(path: &str) -> Result<String, String> {
    let data = std::fs::read(path).map_err(|error| format!("Failed to read docx: {error}"))?;
    let document =
        docx_rs::read_docx(&data).map_err(|error| format!("Failed to parse docx: {error}"))?;

    let mut paragraphs = Vec::new();
    for child in document.document.children {
        if let docx_rs::DocumentChild::Paragraph(paragraph) = child {
            let mut paragraph_text = String::new();
            for content in paragraph.children {
                if let docx_rs::ParagraphChild::Run(run) = content {
                    for child in run.children {
                        match child {
                            docx_rs::RunChild::Text(text) => paragraph_text.push_str(&text.text),
                            docx_rs::RunChild::Break(_) => paragraph_text.push('\n'),
                            _ => {}
                        }
                    }
                }
            }
            let trimmed = paragraph_text.trim();
            if !trimmed.is_empty() {
                paragraphs.push(trimmed.to_string());
            }
        }
    }

    Ok(paragraphs.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use docx_rs::{Docx, Paragraph, Run};
    use std::env;
    use std::fs::File;
    use std::path::PathBuf;
    use uuid::Uuid;

    #[tokio::test]
    async fn test_read_text_file_reads_plain_text() {
        let path = unique_temp_path("txt");
        tokio::fs::write(&path, "plain text").await.unwrap();

        let result = read_text_file(path.to_string_lossy().into_owned())
            .await
            .unwrap();

        assert_eq!(result, "plain text");
        let _ = tokio::fs::remove_file(path).await;
    }

    #[tokio::test]
    async fn test_read_text_file_strips_markdown_formatting() {
        let path = unique_temp_path("md");
        tokio::fs::write(&path, "Hello **world**\n\n```rs\nignored\n```")
            .await
            .unwrap();

        let result = read_text_file(path.to_string_lossy().into_owned())
            .await
            .unwrap();

        assert_eq!(result, "Hello world");
        let _ = tokio::fs::remove_file(path).await;
    }

    #[tokio::test]
    async fn test_read_text_file_reads_docx_content() {
        let path = unique_temp_path("docx");
        create_docx_file(&path);

        let result = read_text_file(path.to_string_lossy().into_owned())
            .await
            .unwrap();

        assert!(result.contains("Hello"));
        assert!(result.contains("World"));
        let _ = tokio::fs::remove_file(path).await;
    }

    #[tokio::test]
    async fn test_read_text_file_rejects_unsupported_extension() {
        let path = unique_temp_path("pdf");
        tokio::fs::write(&path, "%PDF").await.unwrap();

        let error = read_text_file(path.to_string_lossy().into_owned())
            .await
            .unwrap_err();

        assert!(error.contains("Unsupported file type"));
        let _ = tokio::fs::remove_file(path).await;
    }

    #[tokio::test]
    async fn test_read_text_file_rejects_missing_extension() {
        let path = env::temp_dir().join(format!("tts-vue-next-{}", Uuid::new_v4()));
        tokio::fs::write(&path, "plain text").await.unwrap();

        let error = read_text_file(path.to_string_lossy().into_owned())
            .await
            .unwrap_err();

        assert_eq!(error, "File has no extension");
        let _ = tokio::fs::remove_file(path).await;
    }

    #[tokio::test]
    async fn test_show_in_folder_returns_error_for_missing_path() {
        let missing_path = unique_temp_path("txt");

        let error = show_in_folder(missing_path.to_string_lossy().into_owned())
            .await
            .unwrap_err();

        assert!(error.contains("Path not found"));
    }

    #[tokio::test]
    async fn test_read_text_file_rejects_directory_path() {
        let path = env::temp_dir().join(format!("tts-vue-next-dir-{}", Uuid::new_v4()));
        tokio::fs::create_dir(&path).await.unwrap();

        let error = read_text_file(path.to_string_lossy().into_owned())
            .await
            .unwrap_err();

        assert_eq!(error, "Path is not a file");
        let _ = tokio::fs::remove_dir(path).await;
    }

    #[test]
    fn test_map_selected_folder_converts_path() {
        let path = PathBuf::from("example-folder");
        let mapped = map_selected_folder(Some(tauri_plugin_dialog::FilePath::Path(path.clone())));

        assert_eq!(mapped, Some(path.display().to_string()));
    }

    #[test]
    fn test_map_selected_folder_handles_none() {
        assert_eq!(map_selected_folder(None), None);
    }

    #[tokio::test]
    async fn test_write_binary_file_writes_bytes_to_disk() {
        let path = unique_temp_path("mp3");

        write_binary_file(path.to_string_lossy().into_owned(), "AQID".to_string())
            .await
            .unwrap();

        let result = tokio::fs::read(&path).await.unwrap();

        assert_eq!(result, vec![1, 2, 3]);
        let _ = tokio::fs::remove_file(path).await;
    }

    #[tokio::test]
    async fn test_resolve_output_path_returns_original_path_when_file_is_absent() {
        let path = unique_temp_path("mp3");

        let resolved =
            resolve_output_path(path.to_string_lossy().into_owned(), "rename".to_string())
                .await
                .unwrap();

        assert_eq!(resolved, Some(path.to_string_lossy().into_owned()));
    }

    #[tokio::test]
    async fn test_resolve_output_path_skip_returns_none_for_existing_file() {
        let path = unique_temp_path("mp3");
        tokio::fs::write(&path, b"audio").await.unwrap();

        let resolved = resolve_output_path(path.to_string_lossy().into_owned(), "skip".to_string())
            .await
            .unwrap();

        assert_eq!(resolved, None);
        let _ = tokio::fs::remove_file(path).await;
    }

    #[tokio::test]
    async fn test_resolve_output_path_overwrite_keeps_existing_path() {
        let path = unique_temp_path("mp3");
        tokio::fs::write(&path, b"audio").await.unwrap();

        let resolved =
            resolve_output_path(path.to_string_lossy().into_owned(), "overwrite".to_string())
                .await
                .unwrap();

        assert_eq!(resolved, Some(path.to_string_lossy().into_owned()));
        let _ = tokio::fs::remove_file(path).await;
    }

    #[tokio::test]
    async fn test_resolve_output_path_rename_uses_next_free_suffix() {
        let path = unique_temp_path("mp3");
        let parent = path.parent().unwrap().to_path_buf();
        let stem = path.file_stem().unwrap().to_string_lossy().into_owned();
        let first_suffix = parent.join(format!("{stem} (1).mp3"));
        tokio::fs::write(&path, b"audio").await.unwrap();
        tokio::fs::write(&first_suffix, b"audio").await.unwrap();

        let resolved =
            resolve_output_path(path.to_string_lossy().into_owned(), "rename".to_string())
                .await
                .unwrap();

        assert_eq!(
            resolved,
            Some(
                parent
                    .join(format!("{stem} (2).mp3"))
                    .to_string_lossy()
                    .into_owned()
            )
        );
        let _ = tokio::fs::remove_file(path).await;
        let _ = tokio::fs::remove_file(first_suffix).await;
    }

    #[tokio::test]
    async fn test_resolve_output_path_rejects_unknown_strategy() {
        let path = unique_temp_path("mp3");

        let error = resolve_output_path(path.to_string_lossy().into_owned(), "explode".to_string())
            .await
            .unwrap_err();

        assert!(error.contains("Unsupported conflict strategy"));
    }

    #[tokio::test]
    async fn test_remove_file_deletes_existing_temp_audio_file() {
        let path = env::temp_dir().join(format!("tts-vue-next-{}.tmp.mp3", Uuid::new_v4()));
        tokio::fs::write(&path, b"temporary file").await.unwrap();

        remove_file(path.to_string_lossy().into_owned())
            .await
            .unwrap();

        assert!(!path.exists());
    }

    #[tokio::test]
    async fn test_write_binary_file_rejects_non_audio_path() {
        let path = unique_temp_path("txt");

        let error = write_binary_file(path.to_string_lossy().into_owned(), "AQID".to_string())
            .await
            .unwrap_err();

        assert!(error.contains("Unsupported output file type"));
        assert!(!path.exists());
    }

    #[tokio::test]
    async fn test_remove_file_rejects_non_temp_audio_path() {
        let path = unique_temp_path("mp3");
        tokio::fs::write(&path, b"audio").await.unwrap();

        let error = remove_file(path.to_string_lossy().into_owned())
            .await
            .unwrap_err();

        assert!(error.contains("Only temporary audio files can be removed"));
        let _ = tokio::fs::remove_file(path).await;
    }

    fn unique_temp_path(extension: &str) -> PathBuf {
        env::temp_dir().join(format!("tts-vue-next-{}.{}", Uuid::new_v4(), extension))
    }

    fn create_docx_file(path: &PathBuf) {
        let file = File::create(path).unwrap();
        Docx::new()
            .add_paragraph(Paragraph::new().add_run(Run::new().add_text("Hello")))
            .add_paragraph(Paragraph::new().add_run(Run::new().add_text("World")))
            .build()
            .pack(file)
            .unwrap();
    }
}
