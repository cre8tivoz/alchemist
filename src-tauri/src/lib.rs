pub mod chroma;
pub mod commands;
pub mod db;
pub mod errors;
pub mod llm;
pub mod models;
pub mod palace;
pub mod paths;
pub mod providers;
pub mod secret_store;
pub mod validate;

use commands::app;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            app::app_ping,
            app::open_vault,
            app::load_demo_database,
            app::get_schema,
            app::validate_sql,
            app::validate_and_run,
            app::discover_palace,
            app::list_collections,
            app::search_documents,
            app::get_palace_info,
            app::parse_mempalace,
            app::check_ollama,
            app::generate_query,
            app::check_provider,
            app::list_models,
            app::get_provider_config,
            app::store_api_key,
            app::check_api_key,
            app::delete_api_key,
            app::save_spells,
            app::load_spells,
            app::save_config,
            app::load_config,
            app::save_file_dialog,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
