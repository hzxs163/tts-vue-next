mod audio;
mod commands;
mod edge_tts;
mod utils;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first so a second launch focuses this instance
        // instead of spawning a duplicate app with its own probe/voice refresh.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::tts::tts_convert,
            commands::tts::tts_stop,
            commands::service::check_tts_service,
            commands::voices::get_voices,
            commands::file::read_text_file,
            commands::file::select_folder,
            commands::file::show_in_folder,
            commands::file::write_binary_file,
            commands::file::write_text_file,
            commands::file::remove_file,
            commands::file::resolve_output_path,
            commands::audio::convert_audio_format,
            commands::audio::mix_bgm,
        ])
        .setup(|app| {
            crate::utils::log::init(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
