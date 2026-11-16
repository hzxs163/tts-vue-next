use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::Path;

use tauri::Manager;

const LOG_FILE_NAME: &str = "tts-vue-next.log";
const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;

/// Writes log records to the rolling file and to stderr, so `RUST_LOG=debug`
/// keeps working in development while release builds still leave a trace.
struct TeeWriter {
    file: File,
}

impl Write for TeeWriter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        let _ = io::stderr().write_all(buffer);
        self.file.write(buffer)
    }

    fn flush(&mut self) -> io::Result<()> {
        let _ = io::stderr().flush();
        self.file.flush()
    }
}

/// Installs the logger into `<app log dir>/tts-vue-next.log`.
///
/// The previous log is rotated once it grows past 5 MiB; only one archive is
/// kept, which is enough for diagnosing a failed conversion.
pub fn init(app: &tauri::AppHandle) {
    let Ok(log_dir) = app.path().app_log_dir() else {
        return;
    };
    if std::fs::create_dir_all(&log_dir).is_err() {
        return;
    }

    let log_path = log_dir.join(LOG_FILE_NAME);
    rotate_if_needed(&log_path);

    let Ok(file) = OpenOptions::new().create(true).append(true).open(&log_path) else {
        return;
    };

    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .target(env_logger::Target::Pipe(Box::new(TeeWriter { file })))
        .try_init();
}

fn rotate_if_needed(path: &Path) {
    let Ok(metadata) = std::fs::metadata(path) else {
        return;
    };
    if metadata.len() <= MAX_LOG_BYTES {
        return;
    }

    let rotated = path.with_extension("log.1");
    let _ = std::fs::remove_file(&rotated);
    let _ = std::fs::rename(path, rotated);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rotate_if_needed_keeps_small_file() {
        let path =
            std::env::temp_dir().join(format!("tts-vue-next-log-{}.log", uuid::Uuid::new_v4()));
        std::fs::write(&path, b"small").unwrap();

        rotate_if_needed(&path);

        assert!(path.exists());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn test_rotate_if_needed_archives_oversized_file() {
        let path =
            std::env::temp_dir().join(format!("tts-vue-next-log-{}.log", uuid::Uuid::new_v4()));
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(MAX_LOG_BYTES + 1).unwrap();
        drop(file);

        rotate_if_needed(&path);

        assert!(!path.exists());
        assert!(path.with_extension("log.1").exists());
        let _ = std::fs::remove_file(path.with_extension("log.1"));
    }
}
