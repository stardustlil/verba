mod db;
mod net;
mod settings;

use std::sync::Mutex;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = settings::data_dir(app.handle())?;
            let conn = db::open(&dir.join("verba.db"))?;
            app.manage(db::Db(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::db_query,
            db::db_transaction,
            net::fetch_url,
            net::ai_chat,
            settings::get_api_key_masked,
            settings::set_api_key,
            settings::open_data_dir,
            settings::read_text_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
