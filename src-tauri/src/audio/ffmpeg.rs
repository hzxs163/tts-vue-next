use std::env;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tauri::utils::platform;
use tokio::process::Command;

use crate::utils::fs::{partial_path, replace_file};

const SUPPORTED_FORMATS: &[&str] = &["mp3", "wav", "ogg", "flac"];
const FFMPEG_ENV_VAR: &str = "TTS_VUE_NEXT_FFMPEG";
const BUNDLED_FFMPEG_BINARY: &str = "ffmpeg";
const DEFAULT_FFMPEG_BINARY: &str = "ffmpeg";
/// A hung transcode must not block the batch queue forever. Ten minutes is far
/// beyond a normal conversion, even for a multi-hour audiobook.
const FFMPEG_TIMEOUT: Duration = Duration::from_secs(600);
/// Sample rate every filter in the mixing graph runs at.
const MIX_SAMPLE_RATE: u32 = 44100;

struct ResolvedFFmpegProgram {
    program: String,
    source: FFmpegProgramSource,
}

enum FFmpegProgramSource {
    Bundled,
    Configured,
    PathFallback,
}

pub async fn convert_audio(
    input_path: &str,
    output_path: &str,
    format: &str,
) -> Result<(), String> {
    validate_format(format)?;

    let resolved_program = resolve_ffmpeg_program()?;
    let target_path = Path::new(output_path);
    let temp_path = partial_path(target_path);
    let mut command = Command::new(&resolved_program.program);
    command
        .kill_on_drop(true)
        .arg("-i")
        .arg(input_path)
        .arg("-y")
        .arg("-hide_banner")
        .arg("-nostdin")
        .arg("-loglevel")
        .arg("error")
        .args(format_args(format))
        .arg(&temp_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = match tokio::time::timeout(FFMPEG_TIMEOUT, command.output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => {
            remove_partial_output(&temp_path).await;
            return Err(format_ffmpeg_launch_error(&resolved_program, error));
        }
        Err(_) => {
            remove_partial_output(&temp_path).await;
            return Err(format!(
                "ffmpeg timed out after {} seconds while converting {}",
                FFMPEG_TIMEOUT.as_secs(),
                Path::new(input_path).display()
            ));
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        remove_partial_output(&temp_path).await;
        return Err(if stderr.is_empty() {
            "ffmpeg error: unknown error".to_string()
        } else {
            format!("ffmpeg error: {stderr}")
        });
    }

    replace_file(&temp_path, target_path).await
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BgmMixParams {
    pub vocal_path: String,
    pub bgm_path: String,
    pub output_path: String,
    pub bgm_volume: f32,
    pub enable_ducking: bool,
    pub ducking_ratio: f32,
    pub ducking_threshold: f32,
    pub fade_out_sec: f32,
    pub format: String,
}

pub async fn mix_bgm_audio(params: &BgmMixParams) -> Result<(), String> {
    validate_format(&params.format)?;

    let vocal = Path::new(&params.vocal_path);
    if !vocal.is_file() {
        return Err(format!("Vocal audio file not found: {}", params.vocal_path));
    }

    let bgm = Path::new(&params.bgm_path);
    if !bgm.is_file() {
        return Err(format!("BGM audio file not found: {}", params.bgm_path));
    }

    let resolved_program = resolve_ffmpeg_program()?;
    let target_path = Path::new(&params.output_path);
    let temp_path = partial_path(target_path);

    let volume = params.bgm_volume.clamp(0.01, 2.0);
    let ratio = params.ducking_ratio.clamp(1.5, 20.0);
    let threshold = params.ducking_threshold.clamp(0.01, 0.5);
    let fade_out_sec = params.fade_out_sec.clamp(0.0, 5.0);

    // The fade-out starts exactly when the vocal ends, so the vocal length has
    // to be known before the filter graph can be built. The probe only parses
    // the container header; it does not decode the audio.
    let vocal_duration_sec = if fade_out_sec > 0.0 {
        probe_audio_duration_seconds(&resolved_program.program, &params.vocal_path).await
    } else {
        None
    };

    let filtergraph = match vocal_duration_sec {
        Some(vocal_duration) if fade_out_sec > 0.0 => {
            // The vocal is padded with silence so the mix keeps running for
            // `fade_out_sec` more seconds, and the final fade is applied to
            // that tail window - which contains background music only, so the
            // voice itself is never attenuated.
            //
            // The padding happens *before* the split so the sidechain branch
            // stays alive for the whole mix. A sidechain that reaches EOF
            // early stops `sidechaincompress` from emitting, which would
            // silence the music tail completely.
            //
            // `whole_len` is used instead of `pad_dur` because the bundled
            // ffmpeg 4.1 runtime only understands sample counts. Padding to a
            // total length never truncates a vocal that turns out to be
            // slightly longer than the probe reported.
            let total_samples =
                ((vocal_duration + fade_out_sec as f64) * MIX_SAMPLE_RATE as f64).round() as u64;
            let fade_start = format!("{vocal_duration:.3}");
            let fade_duration = format!("{fade_out_sec:.3}");
            format!(
                "[0:a]aformat=sample_rates=44100:channel_layouts=stereo,apad=whole_len={total_samples},asplit=2[vocal_sc][vocal_mix];\
                 [1:a]aformat=sample_rates=44100:channel_layouts=stereo,volume={volume}[bgm];\
                 [bgm][vocal_sc]sidechaincompress=threshold={threshold}:ratio={ratio}:attack=100:release=400[ducked];\
                 [vocal_mix][ducked]amix=inputs=2:duration=first:dropout_transition=0[mixed];\
                 [mixed]afade=t=out:st={fade_start}:d={fade_duration}[out]"
            )
        }
        _ => {
            if params.enable_ducking {
                format!(
                    "[0:a]aformat=sample_rates=44100:channel_layouts=stereo,asplit=2[vocal_sc][vocal_mix];\
                     [1:a]aformat=sample_rates=44100:channel_layouts=stereo,volume={volume}[bgm];\
                     [bgm][vocal_sc]sidechaincompress=threshold={threshold}:ratio={ratio}:attack=100:release=400[ducked];\
                     [vocal_mix][ducked]amix=inputs=2:duration=first:dropout_transition=0[out]"
                )
            } else {
                format!(
                    "[0:a]aformat=sample_rates=44100:channel_layouts=stereo[vocal_mix];\
                     [1:a]aformat=sample_rates=44100:channel_layouts=stereo,volume={volume}[bgm];\
                     [vocal_mix][bgm]amix=inputs=2:duration=first:dropout_transition=0[out]"
                )
            }
        }
    };

    let mut command = Command::new(&resolved_program.program);
    command
        .kill_on_drop(true)
        .arg("-i")
        .arg(&params.vocal_path)
        .arg("-stream_loop")
        .arg("-1")
        .arg("-i")
        .arg(&params.bgm_path)
        .arg("-filter_complex")
        .arg(&filtergraph)
        .arg("-map")
        .arg("[out]")
        .arg("-y")
        .arg("-hide_banner")
        .arg("-nostdin")
        .arg("-loglevel")
        .arg("error")
        .args(format_args(&params.format))
        .arg(&temp_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = match tokio::time::timeout(FFMPEG_TIMEOUT, command.output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => {
            remove_partial_output(&temp_path).await;
            return Err(format_ffmpeg_launch_error(&resolved_program, error));
        }
        Err(_) => {
            remove_partial_output(&temp_path).await;
            return Err(format!(
                "ffmpeg timed out after {} seconds while mixing BGM into {}",
                FFMPEG_TIMEOUT.as_secs(),
                vocal.display()
            ));
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        remove_partial_output(&temp_path).await;
        return Err(if stderr.is_empty() {
            "ffmpeg error: unknown error".to_string()
        } else {
            format!("ffmpeg error: {stderr}")
        });
    }

    replace_file(&temp_path, target_path).await
}

/// Sample rate of the PCM that OpenAI compatible providers hand back, and of
/// the MP3 this app produces everywhere else.
pub const PCM_SAMPLE_RATE: u32 = 24_000;
/// Bytes per millisecond of 16-bit mono PCM at [`PCM_SAMPLE_RATE`].
pub const PCM_BYTES_PER_MS: usize = (PCM_SAMPLE_RATE as usize * 2) / 1000;

/// Silent PCM of the given length.
///
/// Providers that stream raw PCM let silence be plain zero samples, which is
/// far simpler and less error prone than hand building MPEG frames.
pub fn silence_pcm(duration_ms: u64) -> Vec<u8> {
    vec![0u8; duration_ms as usize * PCM_BYTES_PER_MS]
}

/// Encodes raw 24 kHz mono 16-bit PCM into the 24 kHz / 48 kbps mono MP3 that
/// the rest of the pipeline expects.
///
/// Keeping every provider on that one output format is what lets the byte level
/// concatenation and silence splicing stay provider agnostic.
pub async fn encode_pcm_to_mp3(pcm: &[u8]) -> Result<Vec<u8>, String> {
    if pcm.is_empty() {
        return Err("cannot encode empty PCM".to_string());
    }

    let resolved_program = resolve_ffmpeg_program()?;
    let stem = env::temp_dir().join(format!("tts-vue-next-{}", uuid::Uuid::new_v4()));
    let pcm_path = stem.with_extension("pcm");
    let mp3_path = stem.with_extension("mp3");

    tokio::fs::write(&pcm_path, pcm)
        .await
        .map_err(|error| format!("Failed to write temporary PCM: {error}"))?;

    let mut command = Command::new(&resolved_program.program);
    command
        .kill_on_drop(true)
        .args(["-f", "s16le", "-ar", "24000", "-ac", "1", "-i"])
        .arg(&pcm_path)
        .args([
            "-acodec",
            "libmp3lame",
            "-b:a",
            "48k",
            "-ar",
            "24000",
            "-ac",
            "1",
        ])
        // No ID3 tag and no Xing header: those insert bytes before and
        // between MPEG frames, and this stream gets spliced with chunks from
        // other providers. The result is pure CBR frames whose header
        // (`ff f3 64 c4`) matches what the Edge path produces, so the two
        // concatenate cleanly.
        .args(["-id3v2_version", "0", "-write_xing", "0"])
        .arg("-y")
        .arg("-hide_banner")
        .arg("-nostdin")
        .arg("-loglevel")
        .arg("error")
        .arg(&mp3_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = match tokio::time::timeout(FFMPEG_TIMEOUT, command.output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => {
            let _ = tokio::fs::remove_file(&pcm_path).await;
            return Err(format_ffmpeg_launch_error(&resolved_program, error));
        }
        Err(_) => {
            let _ = tokio::fs::remove_file(&pcm_path).await;
            return Err(format!(
                "ffmpeg timed out after {} seconds while encoding PCM",
                FFMPEG_TIMEOUT.as_secs()
            ));
        }
    };

    let result = if output.status.success() {
        tokio::fs::read(&mp3_path)
            .await
            .map_err(|error| format!("Failed to read encoded MP3: {error}"))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            "ffmpeg error: unknown error".to_string()
        } else {
            format!("ffmpeg error: {stderr}")
        })
    };

    let _ = tokio::fs::remove_file(&pcm_path).await;
    let _ = tokio::fs::remove_file(&mp3_path).await;
    result
}

async fn remove_partial_output(path: &Path) {
    let _ = tokio::fs::remove_file(path).await;
}

/// Reads the duration of an audio file without decoding it.
///
/// `ffmpeg` is invoked without an output file on purpose: it parses the
/// container header, prints `Duration: HH:MM:SS.ss` to stderr and then exits
/// with "At least one output file must be specified". Only the header is
/// parsed, so the call stays cheap even for long files.
async fn probe_audio_duration_seconds(program: &str, input_path: &str) -> Option<f64> {
    let mut command = Command::new(program);
    command
        .kill_on_drop(true)
        .arg("-hide_banner")
        .arg("-nostdin")
        .arg("-i")
        .arg(input_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = tokio::time::timeout(Duration::from_secs(30), command.output())
        .await
        .ok()?
        .ok()?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    parse_ffmpeg_duration(&stderr)
}

/// Parses the `Duration: HH:MM:SS.ss` line of an ffmpeg info dump.
fn parse_ffmpeg_duration(stderr: &str) -> Option<f64> {
    for line in stderr.lines() {
        let Some(rest) = line.trim().strip_prefix("Duration:") else {
            continue;
        };
        let Some((timestamp, _)) = rest.split_once(',') else {
            continue;
        };

        let mut total_seconds = 0.0_f64;
        for part in timestamp.trim().split(':') {
            let value = part.trim().parse::<f64>().ok()?;
            total_seconds = total_seconds * 60.0 + value;
        }

        if total_seconds.is_finite() && total_seconds >= 0.0 {
            return Some(total_seconds);
        }
    }

    None
}

#[cfg(test)]
pub async fn save_audio(audio_bytes: &[u8], output_path: &str, format: &str) -> Result<(), String> {
    validate_format(format)?;

    if format == "mp3" {
        return tokio::fs::write(output_path, audio_bytes)
            .await
            .map_err(|error| format!("Failed to write file: {error}"));
    }

    let temp_mp3_path = format!("{output_path}.tmp.mp3");
    tokio::fs::write(&temp_mp3_path, audio_bytes)
        .await
        .map_err(|error| format!("Failed to write temp file: {error}"))?;

    let result = convert_audio(&temp_mp3_path, output_path, format).await;
    let _ = tokio::fs::remove_file(&temp_mp3_path).await;
    result
}

fn validate_format(format: &str) -> Result<(), String> {
    if SUPPORTED_FORMATS.contains(&format) {
        Ok(())
    } else {
        Err(format!("Unsupported audio format: {format}"))
    }
}

fn resolve_ffmpeg_program() -> Result<ResolvedFFmpegProgram, String> {
    if let Some(program) = resolve_bundled_ffmpeg_program() {
        return Ok(ResolvedFFmpegProgram {
            program,
            source: FFmpegProgramSource::Bundled,
        });
    }

    let configured_program = env::var(FFMPEG_ENV_VAR)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if let Some(program) = configured_program {
        if !Path::new(&program).is_file() {
            return Err(format!(
                "Configured ffmpeg binary from {FFMPEG_ENV_VAR} does not exist: {program}"
            ));
        }

        return Ok(ResolvedFFmpegProgram {
            program,
            source: FFmpegProgramSource::Configured,
        });
    }

    Ok(ResolvedFFmpegProgram {
        program: DEFAULT_FFMPEG_BINARY.to_string(),
        source: FFmpegProgramSource::PathFallback,
    })
}

fn resolve_bundled_ffmpeg_program() -> Option<String> {
    let program = bundled_ffmpeg_path().ok()?;
    program
        .is_file()
        .then(|| program.to_string_lossy().into_owned())
}

fn bundled_ffmpeg_path() -> Result<PathBuf, std::io::Error> {
    let exe_path = platform::current_exe()?;
    let exe_dir = exe_path.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "current executable has no parent",
        )
    })?;
    let base_dir = if exe_dir.ends_with("deps") {
        exe_dir.parent().unwrap_or(exe_dir)
    } else {
        exe_dir
    };

    Ok(base_dir.join(sidecar_filename()))
}

fn sidecar_filename() -> &'static str {
    if cfg!(target_os = "windows") {
        "ffmpeg.exe"
    } else {
        BUNDLED_FFMPEG_BINARY
    }
}

fn format_ffmpeg_launch_error(
    resolved_program: &ResolvedFFmpegProgram,
    error: std::io::Error,
) -> String {
    match resolved_program.source {
        FFmpegProgramSource::Bundled => format!(
            "Failed to run bundled ffmpeg ({}): {}. The packaged runtime may be missing or invalid.",
            resolved_program.program, error
        ),
        FFmpegProgramSource::Configured => format!(
            "Failed to run ffmpeg from {FFMPEG_ENV_VAR} ({}): {}",
            resolved_program.program, error
        ),
        FFmpegProgramSource::PathFallback => format!(
            "Failed to run ffmpeg from PATH ({}): {}. Bundled ffmpeg was unavailable, and the development PATH fallback also failed.",
            resolved_program.program, error
        ),
    }
}

fn format_args(format: &str) -> Vec<&'static str> {
    match format {
        "mp3" => vec![],
        "wav" => vec!["-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2"],
        "ogg" => vec!["-acodec", "libvorbis", "-q:a", "5"],
        "flac" => vec!["-acodec", "flac"],
        _ => vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};
    use std::sync::LazyLock;

    use tokio::sync::Mutex;
    use uuid::Uuid;

    static TEST_MUTEX: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    #[tokio::test]
    async fn test_bundled_ffmpeg_binary_is_available_for_execution() {
        let _guard = TEST_MUTEX.lock().await;
        env::remove_var(FFMPEG_ENV_VAR);

        let resolved_program = resolve_ffmpeg_program().unwrap();
        match resolved_program.source {
            FFmpegProgramSource::Bundled => {}
            _ => panic!("expected bundled ffmpeg runtime"),
        }

        let output = Command::new(&resolved_program.program)
            .arg("-version")
            .output()
            .await
            .unwrap();

        assert!(output.status.success());
    }

    #[tokio::test]
    async fn test_resolve_ffmpeg_program_prefers_bundled_binary_over_env_override() {
        let _guard = TEST_MUTEX.lock().await;
        let bundled_ffmpeg_path = bundled_ffmpeg_path_for_current_test_exe();
        let missing_ffmpeg_path = unique_temp_path(script_extension());
        let backup_path = if bundled_ffmpeg_path.exists() {
            let backup_path = unique_temp_path(script_extension());
            tokio::fs::copy(&bundled_ffmpeg_path, &backup_path)
                .await
                .unwrap();
            Some(backup_path)
        } else {
            None
        };

        tokio::fs::write(&bundled_ffmpeg_path, b"bundled ffmpeg marker")
            .await
            .unwrap();

        env::set_var(FFMPEG_ENV_VAR, &missing_ffmpeg_path);
        let resolved_program = resolve_ffmpeg_program();
        env::remove_var(FFMPEG_ENV_VAR);

        if let Some(backup_path) = backup_path {
            tokio::fs::copy(&backup_path, &bundled_ffmpeg_path)
                .await
                .unwrap();
            let _ = tokio::fs::remove_file(backup_path).await;
        } else {
            let _ = tokio::fs::remove_file(&bundled_ffmpeg_path).await;
        }

        assert_eq!(
            resolved_program.unwrap().program,
            bundled_ffmpeg_path.to_string_lossy().into_owned()
        );
    }

    #[tokio::test]
    async fn test_convert_audio_reports_bundled_ffmpeg_failure() {
        let _guard = TEST_MUTEX.lock().await;
        let input_path = unique_temp_path("mp3");
        let output_path = unique_temp_path("ogg");
        let bundled_ffmpeg_path = bundled_ffmpeg_path_for_current_test_exe();
        let backup_path = backup_bundled_ffmpeg().await;
        tokio::fs::write(&input_path, b"fake mp3 bytes")
            .await
            .unwrap();
        tokio::fs::write(&bundled_ffmpeg_path, b"not an executable")
            .await
            .unwrap();
        env::remove_var(FFMPEG_ENV_VAR);

        let error = convert_audio(
            input_path.to_string_lossy().as_ref(),
            output_path.to_string_lossy().as_ref(),
            "ogg",
        )
        .await
        .unwrap_err();

        restore_bundled_ffmpeg(backup_path).await;

        assert!(error.to_ascii_lowercase().contains("bundled"));
        assert!(!error.contains("Install ffmpeg"));

        let _ = tokio::fs::remove_file(input_path).await;
        let _ = tokio::fs::remove_file(output_path).await;
    }

    #[tokio::test]
    async fn test_convert_audio_with_real_ffmpeg_writes_valid_output_atomically() {
        let _guard = TEST_MUTEX.lock().await;
        env::remove_var(FFMPEG_ENV_VAR);
        let input_path = unique_temp_path("wav");
        let output_path = unique_temp_path("wav");
        write_silent_wav(&input_path, 24_000, 0.3);

        let result = convert_audio(
            input_path.to_string_lossy().as_ref(),
            output_path.to_string_lossy().as_ref(),
            "wav",
        )
        .await;

        assert!(result.is_ok(), "{result:?}");
        let bytes = tokio::fs::read(&output_path).await.unwrap();
        assert!(bytes.starts_with(b"RIFF"), "output is not a WAV file");
        assert!(
            !partial_path(Path::new(&output_path)).exists(),
            "a successful conversion must not leave a partial file"
        );

        let _ = tokio::fs::remove_file(input_path).await;
        let _ = tokio::fs::remove_file(output_path).await;
    }

    #[tokio::test]
    async fn test_convert_audio_removes_partial_output_when_ffmpeg_fails() {
        let _guard = TEST_MUTEX.lock().await;
        let input_path = unique_temp_audio_path();
        let output_path = unique_temp_path("ogg");
        let fake_ffmpeg_path = unique_temp_path(script_extension());
        let backup_path = backup_bundled_ffmpeg().await;
        create_failing_ffmpeg(&fake_ffmpeg_path).await;
        tokio::fs::write(&input_path, b"fake mp3 bytes")
            .await
            .unwrap();

        env::set_var(FFMPEG_ENV_VAR, &fake_ffmpeg_path);
        let error = convert_audio(
            input_path.to_string_lossy().as_ref(),
            output_path.to_string_lossy().as_ref(),
            "ogg",
        )
        .await
        .unwrap_err();
        env::remove_var(FFMPEG_ENV_VAR);
        restore_bundled_ffmpeg(backup_path).await;

        assert!(error.contains("ffmpeg error"));
        assert!(
            !Path::new(&output_path).exists(),
            "a failed conversion must not leave a target file"
        );
        assert!(
            !partial_path(Path::new(&output_path)).exists(),
            "a failed conversion must not leave a partial file"
        );

        let _ = tokio::fs::remove_file(input_path).await;
        let _ = tokio::fs::remove_file(fake_ffmpeg_path).await;
    }

    #[tokio::test]
    async fn test_path_launch_error_mentions_bundled_runtime_unavailability() {
        let error = format_ffmpeg_launch_error(
            &ResolvedFFmpegProgram {
                program: DEFAULT_FFMPEG_BINARY.to_string(),
                source: FFmpegProgramSource::PathFallback,
            },
            std::io::Error::new(std::io::ErrorKind::NotFound, "program not found"),
        );

        assert!(error.to_ascii_lowercase().contains("bundled"));
        assert!(!error.contains("Install ffmpeg"));
    }

    #[tokio::test]
    async fn test_convert_audio_reports_configured_ffmpeg_path() {
        let _guard = TEST_MUTEX.lock().await;
        let input_path = unique_temp_audio_path();
        let output_path = unique_temp_path("ogg");
        let missing_ffmpeg_path = unique_temp_path(script_extension());
        let backup_path = backup_bundled_ffmpeg().await;
        tokio::fs::write(&input_path, b"fake mp3 bytes")
            .await
            .unwrap();

        env::set_var(FFMPEG_ENV_VAR, &missing_ffmpeg_path);
        let error = convert_audio(
            input_path.to_string_lossy().as_ref(),
            output_path.to_string_lossy().as_ref(),
            "ogg",
        )
        .await
        .unwrap_err();
        env::remove_var(FFMPEG_ENV_VAR);
        restore_bundled_ffmpeg(backup_path).await;

        assert!(error.contains(FFMPEG_ENV_VAR));
        assert!(error.contains(missing_ffmpeg_path.to_string_lossy().as_ref()));

        let _ = tokio::fs::remove_file(input_path).await;
    }

    #[tokio::test]
    async fn test_save_audio_uses_configured_ffmpeg_for_non_mp3_output() {
        let _guard = TEST_MUTEX.lock().await;
        let output_path = unique_temp_path("ogg");
        let fake_ffmpeg_path = unique_temp_path(script_extension());
        let temp_mp3_path = format!("{}.tmp.mp3", output_path.to_string_lossy());
        let backup_path = backup_bundled_ffmpeg().await;
        create_fake_ffmpeg(&fake_ffmpeg_path).await;

        env::set_var(FFMPEG_ENV_VAR, &fake_ffmpeg_path);
        let result = save_audio(
            b"fake mp3 bytes",
            output_path.to_string_lossy().as_ref(),
            "ogg",
        )
        .await;
        env::remove_var(FFMPEG_ENV_VAR);
        restore_bundled_ffmpeg(backup_path).await;

        assert!(result.is_ok(), "{result:?}");
        assert_eq!(
            tokio::fs::read(&output_path).await.unwrap(),
            b"fake mp3 bytes"
        );
        assert!(!Path::new(&temp_mp3_path).exists());

        let _ = tokio::fs::remove_file(output_path).await;
        let _ = tokio::fs::remove_file(fake_ffmpeg_path).await;
    }

    #[tokio::test]
    async fn test_convert_audio_format_command_uses_configured_ffmpeg_for_non_mp3_output() {
        let _guard = TEST_MUTEX.lock().await;
        let input_path = unique_temp_audio_path();
        let output_path = unique_temp_path("ogg");
        let fake_ffmpeg_path = unique_temp_path(script_extension());
        let backup_path = backup_bundled_ffmpeg().await;
        create_fake_ffmpeg(&fake_ffmpeg_path).await;
        tokio::fs::write(&input_path, b"fake mp3 bytes")
            .await
            .unwrap();

        env::set_var(FFMPEG_ENV_VAR, &fake_ffmpeg_path);
        let result = crate::commands::audio::convert_audio_format(
            input_path.to_string_lossy().into_owned(),
            output_path.to_string_lossy().into_owned(),
            "ogg".to_string(),
        )
        .await;
        env::remove_var(FFMPEG_ENV_VAR);
        restore_bundled_ffmpeg(backup_path).await;

        assert!(result.is_ok(), "{result:?}");
        assert_eq!(
            tokio::fs::read(&output_path).await.unwrap(),
            b"fake mp3 bytes"
        );

        let _ = tokio::fs::remove_file(input_path).await;
        let _ = tokio::fs::remove_file(output_path).await;
        let _ = tokio::fs::remove_file(fake_ffmpeg_path).await;
    }

    #[tokio::test]
    async fn test_mix_bgm_audio_validates_format() {
        let params = BgmMixParams {
            vocal_path: "vocal.mp3".to_string(),
            bgm_path: "bgm.mp3".to_string(),
            output_path: "out.xyz".to_string(),
            bgm_volume: 0.3,
            enable_ducking: true,
            ducking_ratio: 4.0,
            ducking_threshold: 0.1,
            fade_out_sec: 2.0,
            format: "xyz".to_string(),
        };

        let err = mix_bgm_audio(&params).await.unwrap_err();
        assert!(err.contains("Unsupported audio format"));
    }

    #[tokio::test]
    async fn test_mix_bgm_audio_missing_files() {
        let params = BgmMixParams {
            vocal_path: "non_existent_vocal.mp3".to_string(),
            bgm_path: "non_existent_bgm.mp3".to_string(),
            output_path: "out.mp3".to_string(),
            bgm_volume: 0.3,
            enable_ducking: true,
            ducking_ratio: 4.0,
            ducking_threshold: 0.1,
            fade_out_sec: 2.0,
            format: "mp3".to_string(),
        };

        let err = mix_bgm_audio(&params).await.unwrap_err();
        assert!(err.contains("Vocal audio file not found"));
    }

    #[tokio::test]
    async fn test_mix_bgm_audio_with_ducking_success() {
        let _guard = TEST_MUTEX.lock().await;
        env::remove_var(FFMPEG_ENV_VAR);
        let vocal_path = unique_temp_path("wav");
        let bgm_path = unique_temp_path("wav");
        let output_path = unique_temp_path("wav");

        write_silent_wav(&vocal_path, 24_000, 0.4);
        write_silent_wav(&bgm_path, 24_000, 0.4);

        let params = BgmMixParams {
            vocal_path: vocal_path.to_string_lossy().into_owned(),
            bgm_path: bgm_path.to_string_lossy().into_owned(),
            output_path: output_path.to_string_lossy().into_owned(),
            bgm_volume: 0.3,
            enable_ducking: true,
            ducking_ratio: 4.0,
            ducking_threshold: 0.1,
            fade_out_sec: 1.0,
            format: "wav".to_string(),
        };

        let result = mix_bgm_audio(&params).await;
        assert!(result.is_ok(), "{result:?}");

        let output_bytes = tokio::fs::read(&output_path).await.unwrap();
        assert!(output_bytes.starts_with(b"RIFF"));

        let _ = tokio::fs::remove_file(vocal_path).await;
        let _ = tokio::fs::remove_file(bgm_path).await;
        let _ = tokio::fs::remove_file(output_path).await;
    }

    #[test]
    fn test_silence_pcm_matches_the_byte_rate() {
        // 16-bit mono at 24 kHz is 48 bytes per millisecond.
        assert_eq!(PCM_BYTES_PER_MS, 48);
        assert_eq!(silence_pcm(0).len(), 0);
        assert_eq!(silence_pcm(1000).len(), 48_000);
        assert_eq!(silence_pcm(24).len(), 1_152);
        assert!(silence_pcm(10).iter().all(|byte| *byte == 0));
    }

    #[tokio::test]
    async fn test_encode_pcm_to_mp3_produces_playable_audio_of_the_right_length() {
        let _guard = TEST_MUTEX.lock().await;
        env::remove_var(FFMPEG_ENV_VAR);

        // The whole OpenAI pipeline rests on this: raw PCM in, the project's
        // single MP3 format out.
        let pcm = silence_pcm(1_000);
        let mp3 = encode_pcm_to_mp3(&pcm)
            .await
            .expect("encoding should succeed");

        assert!(!mp3.is_empty());
        // MPEG audio frame sync: 11 bits set.
        assert_eq!(
            &mp3[..4],
            &[0xff, 0xf3, 0x64, 0xc4],
            "the encoded frames must use the same 24 kHz / 48 kbps mono header \
             as the Edge path so the two can be spliced"
        );

        let output_path = unique_temp_path("mp3");
        tokio::fs::write(&output_path, &mp3).await.unwrap();
        let program = resolve_ffmpeg_program().unwrap().program;
        let duration = probe_audio_duration_seconds(&program, &output_path.to_string_lossy())
            .await
            .expect("the encoded file should be probeable");

        assert!(
            (duration - 1.0).abs() < 0.15,
            "encoded duration should match the PCM length (got {duration})"
        );

        let _ = tokio::fs::remove_file(output_path).await;
    }

    #[tokio::test]
    async fn test_encode_pcm_to_mp3_rejects_empty_input() {
        let error = encode_pcm_to_mp3(&[]).await.unwrap_err();
        assert!(error.contains("empty"));
    }

    #[tokio::test]
    async fn test_encode_pcm_to_mp3_leaves_no_temporary_files() {
        let _guard = TEST_MUTEX.lock().await;
        env::remove_var(FFMPEG_ENV_VAR);

        let before = count_temp_files();
        let _ = encode_pcm_to_mp3(&silence_pcm(120)).await.unwrap();
        let after = count_temp_files();

        assert_eq!(after, before, "temporary PCM and MP3 files must be removed");
    }

    fn count_temp_files() -> usize {
        std::fs::read_dir(env::temp_dir())
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .filter(|entry| {
                        let name = entry.file_name();
                        let name = name.to_string_lossy();
                        name.starts_with("tts-vue-next-")
                            && (name.ends_with(".pcm") || name.ends_with(".mp3"))
                    })
                    .count()
            })
            .unwrap_or(0)
    }

    #[test]
    fn test_parse_ffmpeg_duration_handles_common_shapes() {
        let stderr = "  Duration: 00:00:04.49, start: 0.000000, bitrate: 48 kb/s\n";
        assert_eq!(parse_ffmpeg_duration(stderr), Some(4.49));

        let stderr = "  Duration: 01:02:03.50, start: 0.000000, bitrate: 128 kb/s\n";
        assert_eq!(parse_ffmpeg_duration(stderr), Some(3723.5));

        assert_eq!(parse_ffmpeg_duration("no duration here"), None);
        assert_eq!(
            parse_ffmpeg_duration("  Duration: not-a-time, bitrate: 1 kb/s\n"),
            None
        );
    }

    #[tokio::test]
    async fn test_mix_bgm_fade_out_extends_the_mix_with_a_fading_tail() {
        let _guard = TEST_MUTEX.lock().await;
        env::remove_var(FFMPEG_ENV_VAR);

        let resolved_program = resolve_ffmpeg_program().unwrap();
        let vocal_path = unique_temp_path("wav");
        let bgm_path = unique_temp_path("wav");
        let plain_output = unique_temp_path("wav");
        let faded_output = unique_temp_path("wav");

        write_tone_wav(&vocal_path, 44_100, 1.0, 440.0);
        write_tone_wav(&bgm_path, 44_100, 0.5, 120.0);

        let plain_params = BgmMixParams {
            vocal_path: vocal_path.to_string_lossy().into_owned(),
            bgm_path: bgm_path.to_string_lossy().into_owned(),
            output_path: plain_output.to_string_lossy().into_owned(),
            bgm_volume: 0.3,
            enable_ducking: true,
            ducking_ratio: 4.0,
            ducking_threshold: 0.1,
            fade_out_sec: 0.0,
            format: "wav".to_string(),
        };

        assert!(mix_bgm_audio(&plain_params).await.is_ok());
        let plain_duration = probe_audio_duration_seconds(
            &resolved_program.program,
            &plain_output.to_string_lossy(),
        )
        .await
        .expect("expected a duration for the plain mix");

        let faded_params = BgmMixParams {
            output_path: faded_output.to_string_lossy().into_owned(),
            fade_out_sec: 1.0,
            ..plain_params
        };

        assert!(mix_bgm_audio(&faded_params).await.is_ok());
        let faded_duration = probe_audio_duration_seconds(
            &resolved_program.program,
            &faded_output.to_string_lossy(),
        )
        .await
        .expect("expected a duration for the faded mix");

        // The fade-out must actually append a fading music tail. Before the
        // fix `fade_out_sec` was mapped to `amix`'s `dropout_transition`,
        // which had no effect and produced a byte-identical file.
        assert!(
            faded_duration > plain_duration + 0.5,
            "faded mix should be longer than the plain mix (plain={plain_duration}, faded={faded_duration})"
        );
        assert!(
            (faded_duration - plain_duration - 1.0).abs() < 0.3,
            "faded mix should extend by roughly the fade duration (plain={plain_duration}, faded={faded_duration})"
        );

        // A duration check alone is not enough: an earlier version of the
        // filter graph produced a long but completely silent tail because the
        // sidechain branch reached EOF before the music tail.
        let samples = decode_wav_to_samples(&resolved_program.program, &faded_output).await;
        assert!(!samples.is_empty(), "expected decoded samples");

        let sample_rate = 44_100_f64;
        let tail_start = (faded_duration - 0.2) * sample_rate;
        let tail_peak = peak_between(&samples, tail_start, faded_duration * sample_rate);
        let body_peak = peak_between(&samples, 0.1 * sample_rate, 0.8 * sample_rate);

        assert!(body_peak > 100, "expected audible audio in the body");
        assert!(
            tail_peak < body_peak / 4,
            "tail must fade out (tail_peak={tail_peak}, body_peak={body_peak})"
        );

        let _ = tokio::fs::remove_file(vocal_path).await;
        let _ = tokio::fs::remove_file(bgm_path).await;
        let _ = tokio::fs::remove_file(plain_output).await;
        let _ = tokio::fs::remove_file(faded_output).await;
    }

    /// Decodes a WAV file into mono 16-bit samples using ffmpeg.
    async fn decode_wav_to_samples(program: &str, path: &Path) -> Vec<i16> {
        let output = Command::new(program)
            .arg("-hide_banner")
            .arg("-v")
            .arg("error")
            .arg("-i")
            .arg(path)
            .arg("-f")
            .arg("s16le")
            .arg("-acodec")
            .arg("pcm_s16le")
            .arg("-ac")
            .arg("1")
            .arg("-")
            .output()
            .await
            .expect("ffmpeg decode failed");

        let bytes = output.stdout;
        bytes
            .chunks_exact(2)
            .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]))
            .collect()
    }

    fn peak_between(samples: &[i16], start: f64, end: f64) -> i32 {
        let start = (start.max(0.0) as usize).min(samples.len());
        let end = (end.max(0.0) as usize).min(samples.len());
        samples[start..end]
            .iter()
            .map(|sample| i32::from(sample.abs()))
            .max()
            .unwrap_or(0)
    }

    async fn backup_bundled_ffmpeg() -> Option<PathBuf> {
        let bundled_ffmpeg_path = bundled_ffmpeg_path_for_current_test_exe();
        if bundled_ffmpeg_path.exists() {
            let backup_path = unique_temp_path(script_extension());
            tokio::fs::copy(&bundled_ffmpeg_path, &backup_path)
                .await
                .unwrap();
            tokio::fs::remove_file(&bundled_ffmpeg_path).await.unwrap();
            Some(backup_path)
        } else {
            None
        }
    }

    async fn restore_bundled_ffmpeg(backup_path: Option<PathBuf>) {
        let bundled_ffmpeg_path = bundled_ffmpeg_path_for_current_test_exe();
        if let Some(path) = backup_path {
            tokio::fs::copy(&path, &bundled_ffmpeg_path).await.unwrap();
            let _ = tokio::fs::remove_file(path).await;
        } else {
            let _ = tokio::fs::remove_file(&bundled_ffmpeg_path).await;
        }
    }

    async fn create_fake_ffmpeg(path: &Path) {
        #[cfg(target_os = "windows")]
        let script = "@echo off\r\nsetlocal enabledelayedexpansion\r\nset \"last=\"\r\nfor %%a in (%*) do set \"last=%%~a\"\r\ncopy /y \"%~2\" \"!last!\" >nul\r\n";

        #[cfg(not(target_os = "windows"))]
        let script = "#!/bin/sh\nfor last do :; done\ncp \"$2\" \"$last\"\n";

        tokio::fs::write(path, script).await.unwrap();

        #[cfg(not(target_os = "windows"))]
        {
            use std::os::unix::fs::PermissionsExt;

            let permissions = std::fs::Permissions::from_mode(0o755);
            tokio::fs::set_permissions(path, permissions).await.unwrap();
        }
    }

    async fn create_failing_ffmpeg(path: &Path) {
        #[cfg(target_os = "windows")]
        let script = "@echo off\r\nsetlocal enabledelayedexpansion\r\nset \"last=\"\r\nfor %%a in (%*) do set \"last=%%~a\"\r\necho partial> \"!last!\"\r\nexit /b 2\r\n";

        #[cfg(not(target_os = "windows"))]
        let script = "#!/bin/sh\nfor last do :; done\nprintf partial > \"$last\"\nexit 2\n";

        tokio::fs::write(path, script).await.unwrap();

        #[cfg(not(target_os = "windows"))]
        {
            use std::os::unix::fs::PermissionsExt;

            let permissions = std::fs::Permissions::from_mode(0o755);
            tokio::fs::set_permissions(path, permissions).await.unwrap();
        }
    }

    fn script_extension() -> &'static str {
        #[cfg(target_os = "windows")]
        {
            "cmd"
        }

        #[cfg(not(target_os = "windows"))]
        {
            "sh"
        }
    }

    fn unique_temp_audio_path() -> PathBuf {
        env::temp_dir().join(format!("tts-vue-next-{}.tmp.mp3", Uuid::new_v4()))
    }

    fn unique_temp_path(extension: &str) -> PathBuf {
        env::temp_dir().join(format!("tts-vue-next-{}.{}", Uuid::new_v4(), extension))
    }

    fn write_silent_wav(path: &Path, sample_rate: u32, seconds: f32) {
        write_wav(path, sample_rate, seconds, |_| 0.0);
    }

    /// Writes a mono 16-bit WAV holding a sine tone.
    fn write_tone_wav(path: &Path, sample_rate: u32, seconds: f32, frequency: f32) {
        write_wav(path, sample_rate, seconds, |index| {
            let time = index as f32 / sample_rate as f32;
            (time * frequency * 2.0 * std::f32::consts::PI).sin() * 0.5
        });
    }

    fn write_wav(path: &Path, sample_rate: u32, seconds: f32, sample: impl Fn(usize) -> f32) {
        let sample_count = (sample_rate as f32 * seconds).round() as u32;
        let data_length = sample_count * 2;
        let mut bytes = Vec::with_capacity(44 + data_length as usize);

        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_length).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&sample_rate.to_le_bytes());
        bytes.extend_from_slice(&(sample_rate * 2).to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&16u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_length.to_le_bytes());

        for index in 0..sample_count {
            let value = (sample(index as usize) * i16::MAX as f32) as i16;
            bytes.extend_from_slice(&value.to_le_bytes());
        }

        std::fs::write(path, bytes).unwrap();
    }

    fn bundled_ffmpeg_path_for_current_test_exe() -> PathBuf {
        super::bundled_ffmpeg_path().unwrap()
    }

    #[allow(dead_code)]
    fn sidecar_filename() -> String {
        super::sidecar_filename().to_string()
    }
}
