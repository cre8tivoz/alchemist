use crate::chroma;
use crate::db;
use crate::llm;
use crate::models::{
    CollectionInfo, GeneratedQuery, MemPalaceStructure, PalaceDiscovery, PalaceInfo,
    ProviderConfig, ProviderHealth, QueryResult, SearchResult, TableSchema, ValidatedQuery,
    VaultSummary,
};
use crate::palace;
use crate::providers::{GeminiClient, OllamaClient, OpenAIClient};
use crate::validate;

const DEFAULT_OLLAMA_MODEL: &str = "llama3.2";

#[tauri::command]
pub fn open_vault(path: String) -> Result<VaultSummary, String> {
    let extension = PathBuf::from(&path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase())
        .unwrap_or_default();

    match extension.as_str() {
        "csv" | "json" | "yaml" | "yml" => {
            let imported_path = db::import_tabular_file(&path).map_err(|e| e.to_string())?;
            let mut summary = db::open_vault(&imported_path).map_err(|e| e.to_string())?;
            if let Some(name) = PathBuf::from(&path)
                .file_name()
                .and_then(|name| name.to_str())
            {
                summary.file_name = name.to_string();
            }
            Ok(summary)
        }
        _ => db::open_vault(&path).map_err(|e| e.to_string()),
    }
}

#[tauri::command]
pub fn load_demo_database(db_name: String) -> Result<VaultSummary, String> {
    let file_name = match db_name.as_str() {
        "easy-coven" => "alchemist_easy_coven.db",
        "medium-shadow" => "alchemist_medium_shadow.db",
        "hard-eternal" => "alchemist_hard_eternal.db",
        _ => return Err(format!("Unknown demo database: {}", db_name)),
    };

    let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "Could not resolve project root".to_string())?;
    let demo_path = project_root.join("test-data").join(file_name);

    db::open_vault(&demo_path.to_string_lossy()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_schema(path: String) -> Result<Vec<TableSchema>, String> {
    db::get_schema(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn validate_sql(sql: String) -> Result<ValidatedQuery, String> {
    validate::validate_sql(&sql).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn validate_and_run(path: String, sql: String) -> Result<QueryResult, String> {
    let validated = validate::validate_sql(&sql).map_err(|e| e.to_string())?;
    let critical_failed: Vec<_> = validated
        .checks
        .iter()
        .filter(|c| !c.passed && c.code != "limit")
        .collect();

    if !critical_failed.is_empty() {
        let reasons: Vec<String> = critical_failed
            .iter()
            .map(|c| format!("{}: {}", c.label, c.detail))
            .collect();
        return Err(format!(
            "Query blocked by safety checks:\n{}",
            reasons.join("\n")
        ));
    }

    db::run_query(&path, &validated.final_sql).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn app_ping() -> String {
    "Alchemist backend awake".to_string()
}

// ── ChromaDB / Palace commands ──

#[tauri::command]
pub fn discover_palace(path: String) -> Result<PalaceDiscovery, String> {
    chroma::discover_palace(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_collections(palace_path: String) -> Result<Vec<CollectionInfo>, String> {
    chroma::list_collections(&palace_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_documents(
    palace_path: String,
    query: String,
    collection_name: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<SearchResult>, String> {
    let max_results = limit.unwrap_or(20);
    chroma::search_documents(
        &palace_path,
        &query,
        collection_name.as_deref(),
        max_results,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_palace_info(palace_path: String) -> Result<PalaceInfo, String> {
    chroma::get_palace_info(&palace_path).map_err(|e| e.to_string())
}

// ── MemPalace commands ──

#[tauri::command]
pub fn parse_mempalace(path: Option<String>) -> Result<MemPalaceStructure, String> {
    palace::discover_and_parse(path.as_deref()).map_err(|e| e.to_string())
}

// ── LLM / Provider commands ──

#[tauri::command]
pub async fn check_ollama() -> Result<ProviderHealth, String> {
    let client = OllamaClient::new("http://localhost:11434", DEFAULT_OLLAMA_MODEL);
    client.check_health().await
}

#[tauri::command]
pub async fn check_provider(
    provider_type: String,
    url: String,
    model: String,
    api_key: Option<String>,
) -> Result<ProviderHealth, String> {
    match provider_type.as_str() {
        "openai" | "deepseek" => {
            let key = api_key
                .filter(|k| !k.is_empty())
                .or_else(|| {
                    crate::secret_store::get_key(&format!("{}_api_key", provider_type)).ok()
                })
                .unwrap_or_default();
            let client = OpenAIClient::new(&url, &model, &key);
            client.check_health().await
        }
        "google-ai" => {
            let key = api_key
                .filter(|k| !k.is_empty())
                .or_else(|| crate::secret_store::get_key("google_ai_api_key").ok())
                .unwrap_or_default();
            let client = GeminiClient::new(&url, &model, &key);
            client.check_health().await
        }
        _ => {
            let client = OllamaClient::new(&url, &model);
            client.check_health().await
        }
    }
}

#[tauri::command]
pub async fn list_models(
    provider_type: String,
    url: String,
    api_key: Option<String>,
) -> Result<Vec<String>, String> {
    match provider_type.as_str() {
        "ollama" => {
            let client = OllamaClient::new(&url, "");
            let health = client.check_health().await?;
            Ok(health.models)
        }
        "google-ai" => {
            let key = api_key.unwrap_or_default();
            let client = GeminiClient::new(&url, "gemini-2.5-flash", &key);
            client.list_models().await
        }
        _ => {
            // For OpenAI-compatible providers, hit the /models endpoint
            let key = api_key.unwrap_or_default();
            let client = OpenAIClient::new(&url, "", &key);
            let health = client.check_health().await?;
            Ok(health.models)
        }
    }
}

#[tauri::command]
pub async fn generate_query(
    question: String,
    schema_json: Option<String>,
    palace_json: Option<String>,
    provider_type: Option<String>,
    provider_url: Option<String>,
    provider_model: Option<String>,
    source_type: Option<String>,
) -> Result<GeneratedQuery, String> {
    let start = std::time::Instant::now();
    let mode = llm::mode_for_source(source_type.as_deref(), &question);
    let provider = provider_type
        .clone()
        .unwrap_or_else(|| "ollama".to_string());
    let url = provider_url.unwrap_or_else(|| "http://localhost:11434".to_string());
    let model = provider_model.unwrap_or_else(|| DEFAULT_OLLAMA_MODEL.to_string());

    let prompt = match mode {
        "yaml_query" => {
            // Parse palace context from JSON
            if let Some(json) = palace_json {
                if let Ok(palace) = serde_json::from_str::<MemPalaceStructure>(&json) {
                    llm::build_yaml_query_prompt(&question, &palace)
                } else {
                    format!("Describe the structure of this MemPalace: {}", question)
                }
            } else {
                format!("Describe the structure of this MemPalace: {}", question)
            }
        }
        "vector_search" => {
            let mut available_keys = vec![
                "wing".to_string(),
                "room".to_string(),
                "hall".to_string(),
                "entities".to_string(),
                "source_file".to_string(),
                "added_by".to_string(),
            ];
            // Extract available metadata from palace context if provided
            if let Some(json) = &palace_json {
                if let Ok(palace) = serde_json::from_str::<MemPalaceStructure>(json) {
                    let mut extra_keys: Vec<String> = palace
                        .wings
                        .iter()
                        .flat_map(|w| w.rooms.iter())
                        .flat_map(|r| r.keywords.clone())
                        .collect();
                    extra_keys.sort();
                    extra_keys.dedup();
                    available_keys.extend(extra_keys);
                }
            }
            llm::build_vector_search_prompt(&question, "", &available_keys)
        }
        _ => {
            // SQL mode
            if let Some(json) = schema_json {
                if let Ok(tables) = serde_json::from_str::<Vec<TableSchema>>(&json) {
                    llm::build_sql_prompt(&question, &tables, tables.len())
                } else {
                    format!("Write a read-only SQLite SELECT query for: {}", question)
                }
            } else {
                format!("Write a read-only SQLite SELECT query for: {}", question)
            }
        }
    };

    let raw_response = match provider.as_str() {
        "openai" => {
            let api_key = crate::secret_store::get_key("openai_api_key")
                .map_err(|_| "OpenAI API key not found. Please add one in Settings.".to_string())?;
            let client = OpenAIClient::new(&url, &model, &api_key);
            client.generate(&prompt).await?
        }
        "deepseek" => {
            let api_key = crate::secret_store::get_key("deepseek_api_key").map_err(|_| {
                "DeepSeek API key not found. Please add one in Settings.".to_string()
            })?;
            let client = OpenAIClient::new(&url, &model, &api_key);
            client.generate(&prompt).await?
        }
        "google-ai" => {
            let api_key = crate::secret_store::get_key("google_ai_api_key").map_err(|_| {
                "Google AI API key not found. Please add one in Settings.".to_string()
            })?;
            let client = GeminiClient::new(&url, &model, &api_key);
            client.generate(&prompt).await?
        }
        _ => {
            let client = OllamaClient::new(&url, &model);
            client.generate(&prompt).await?
        }
    };

    let elapsed_ms = start.elapsed().as_millis() as u64;

    // Parse response based on mode
    let (sql, search_terms) = match mode {
        "yaml_query" => {
            // YAML mode returns the raw description
            (Some(raw_response.clone()), None)
        }
        "vector_search" => {
            let terms = llm::parse_search_terms(&raw_response);
            (None, Some(terms))
        }
        _ => {
            let parsed = llm::parse_sql_from_response(&raw_response);
            (parsed, None)
        }
    };

    Ok(GeneratedQuery {
        question,
        sql,
        search_terms,
        mode: mode.to_string(),
        raw_response,
        provider: provider_type.unwrap_or_else(|| "ollama".to_string()),
        model,
        elapsed_ms,
    })
}

#[tauri::command]
pub fn get_provider_config() -> ProviderConfig {
    let has_key = crate::secret_store::has_key("openai_api_key");
    ProviderConfig {
        provider_type: "ollama".to_string(),
        ollama_url: "http://localhost:11434".to_string(),
        ollama_model: format!("{}:latest", DEFAULT_OLLAMA_MODEL),
        openai_url: "https://api.openai.com/v1".to_string(),
        openai_model: "gpt-4o-mini".to_string(),
        has_openai_key: has_key,
    }
}

#[tauri::command]
pub fn store_api_key(account: String, key: String) -> Result<(), String> {
    crate::secret_store::store_key(&account, &key)
}

#[tauri::command]
pub fn check_api_key(account: String) -> Result<bool, String> {
    Ok(crate::secret_store::has_key(&account))
}

#[tauri::command]
pub fn delete_api_key(account: String) -> Result<(), String> {
    crate::secret_store::delete_key(&account)
}

// ── Persistence commands ──

use std::path::PathBuf;

fn data_dir() -> PathBuf {
    crate::paths::user_home().join(".alchemist")
}

#[tauri::command]
pub fn save_spells(spells_json: String) -> Result<(), String> {
    let dir = data_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create data dir: {}", e))?;
    let path = dir.join("spells.json");
    std::fs::write(&path, &spells_json).map_err(|e| format!("Failed to save spells: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn load_spells() -> Result<String, String> {
    let path = data_dir().join("spells.json");
    if !path.exists() {
        return Ok("[]".to_string());
    }
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to load spells: {}", e))
}

#[tauri::command]
pub fn save_config(config_json: String) -> Result<(), String> {
    let dir = data_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create data dir: {}", e))?;
    let path = dir.join("config.json");
    std::fs::write(&path, &config_json).map_err(|e| format!("Failed to save config: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn load_config() -> Result<String, String> {
    let path = data_dir().join("config.json");
    if !path.exists() {
        return Ok("{}".to_string());
    }
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to load config: {}", e))
}

/// Save content to a file using a native save dialog.
#[tauri::command]
pub async fn save_file_dialog(
    app: tauri::AppHandle,
    content: String,
    suggested_name: String,
) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    // blocking_save_file must NOT run on the main thread
    let save_path = tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_file_name(&suggested_name)
            .set_title("Export Results")
            .blocking_save_file()
    })
    .await
    .map_err(|e| format!("Dialog task failed: {}", e))?;

    match save_path {
        Some(path) => {
            let p = path.to_string();
            tokio::fs::write(&p, content)
                .await
                .map_err(|e| format!("Failed to write file: {}", e))?;
            Ok(p)
        }
        None => Err("cancelled".to_string()),
    }
}
