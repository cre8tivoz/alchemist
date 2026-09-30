use rusqlite::{Connection, OpenFlags};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::errors::AppError;
use crate::models::{ColumnSchema, QueryResult, TableSchema, VaultSummary};

#[derive(Debug, Clone, Copy)]
enum InferredType {
    Integer,
    Real,
    Text,
}

/// Open a SQLite file in read-only mode and return its summary.
pub fn open_vault(path: &str) -> Result<VaultSummary, AppError> {
    let conn = open_connection(path)?;

    let db_path = Path::new(path);
    let file_name = db_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let size_bytes = std::fs::metadata(db_path)?.len();
    let table_count = count_tables(&conn)?;
    let opened_at = chrono::Utc::now().to_rfc3339();

    Ok(VaultSummary {
        path: path.to_string(),
        file_name,
        table_count,
        size_bytes,
        opened_at,
    })
}

/// Get the schema for all tables in the database.
pub fn get_schema(path: &str) -> Result<Vec<TableSchema>, AppError> {
    let conn = open_connection(path)?;
    let mut schemas = Vec::new();

    let mut stmt = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )?;
    let table_names: Vec<String> = stmt
        .query_map([], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    for name in &table_names {
        let columns = get_columns_for_table(&conn, name)?;
        let quoted_name = quote_identifier(name);
        let row_count: i64 = conn
            .query_row(
                &format!("SELECT COUNT(*) FROM {}", quoted_name),
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        let sample_rows = get_sample_rows(&conn, name, &columns)?;

        schemas.push(TableSchema {
            name: name.clone(),
            columns,
            row_count: Some(row_count),
            sample_rows: Some(sample_rows),
        });
    }

    Ok(schemas)
}

/// Execute a SELECT query and return the results.
pub fn run_query(path: &str, sql: &str) -> Result<QueryResult, AppError> {
    let conn = open_connection(path)?;
    let start = std::time::Instant::now();

    let mut stmt = conn.prepare(sql)?;
    let col_count = stmt.column_count();
    let columns: Vec<String> = (0..col_count)
        .map(|i| stmt.column_name(i).unwrap_or("?").to_string())
        .collect();

    let mut rows = Vec::new();
    let max_rows = 1000;
    let mut truncated = false;

    let row_iter = stmt.query_map([], |row| {
        let mut values = Vec::new();
        for i in 0..col_count {
            let val: rusqlite::types::Value = row.get_unwrap(i);
            values.push(match val {
                rusqlite::types::Value::Null => serde_json::Value::Null,
                rusqlite::types::Value::Integer(i) => serde_json::Value::Number(i.into()),
                rusqlite::types::Value::Real(f) => serde_json::Number::from_f64(f)
                    .map(serde_json::Value::Number)
                    .unwrap_or(serde_json::Value::Null),
                rusqlite::types::Value::Text(t) => serde_json::Value::String(t),
                rusqlite::types::Value::Blob(_) => serde_json::Value::String("[BLOB]".to_string()),
            });
        }
        Ok(values)
    })?;

    for row in row_iter {
        if rows.len() >= max_rows {
            truncated = true;
            break;
        }
        rows.push(row?);
    }

    let elapsed_ms = start.elapsed().as_millis() as u64;
    let row_count = rows.len();

    Ok(QueryResult {
        columns,
        rows,
        row_count,
        truncated,
        elapsed_ms,
    })
}

/// Import a tabular CSV/JSON/YAML file into a generated SQLite database.
pub fn import_tabular_file(path: &str) -> Result<String, AppError> {
    let source = Path::new(path);
    if !source.exists() {
        return Err(AppError::NotFound(format!("File not found: {}", path)));
    }

    let extension = source
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase())
        .unwrap_or_default();

    let rows = match extension.as_str() {
        "csv" => read_csv_rows(source)?,
        "json" => read_json_rows(source)?,
        "yaml" | "yml" => read_yaml_rows(source)?,
        _ => {
            return Err(AppError::Validation(format!(
                "Unsupported import type: {}",
                extension
            )))
        }
    };

    if rows.is_empty() {
        return Err(AppError::Validation(
            "Imported file does not contain any rows".to_string(),
        ));
    }

    let stem = source
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("imported_data");
    let table_name = sanitize_identifier(stem);
    let output_path = imports_dir()?.join(format!(
        "{}-{}.sqlite",
        table_name,
        uuid::Uuid::new_v4().simple()
    ));

    write_rows_to_sqlite(&output_path, &table_name, &rows)?;
    Ok(output_path.to_string_lossy().to_string())
}

// ---- Internal helpers ----

pub(crate) fn validate_db_path(path: &Path) -> Result<(), AppError> {
    let raw_str = path.to_string_lossy();
    // Extract file path portion if raw_str is formatted as a URI or contains query params (e.g. file:///path?mode=ro)
    let clean_str = if let Some(stripped) = raw_str.strip_prefix("file://") {
        stripped.split('?').next().unwrap_or(stripped)
    } else {
        raw_str.split('?').next().unwrap_or(&raw_str)
    };

    let clean_path = Path::new(clean_str);

    if let Some(ext) = clean_path.extension().and_then(|e| e.to_str()) {
        let ext_lower = ext.to_lowercase();
        if ext_lower == "sqlite" || ext_lower == "db" || ext_lower == "sqlite3" {
            return Ok(());
        }
    }

    let alchemist_dir = crate::paths::user_home().join(".alchemist");
    let temp_dir = std::env::temp_dir();

    if let Ok(canon_path) = clean_path.canonicalize() {
        if let Ok(canon_alchemist) = alchemist_dir.canonicalize() {
            if canon_path.starts_with(&canon_alchemist) {
                return Ok(());
            }
        } else if canon_path.starts_with(&alchemist_dir) {
            return Ok(());
        }

        if let Ok(canon_temp) = temp_dir.canonicalize() {
            if canon_path.starts_with(&canon_temp) {
                return Ok(());
            }
        } else if canon_path.starts_with(&temp_dir) {
            return Ok(());
        }
    } else {
        if clean_path.starts_with(&alchemist_dir) || clean_path.starts_with(&temp_dir) {
            return Ok(());
        }
    }

    Err(AppError::Validation(format!(
        "Invalid database file path: {}. Path must end with .sqlite, .db, or .sqlite3, or be located within a permitted directory.",
        path.display()
    )))
}

fn open_connection(path: &str) -> Result<Connection, AppError> {
    let db_path = Path::new(path);
    if !db_path.exists() {
        return Err(AppError::NotFound(format!("File not found: {}", path)));
    }

    validate_db_path(db_path)?;

    Ok(Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
    )?)
}

fn read_csv_rows(path: &Path) -> Result<Vec<BTreeMap<String, serde_json::Value>>, AppError> {
    let mut reader = csv::Reader::from_path(path)
        .map_err(|e| AppError::Validation(format!("Failed to read CSV: {}", e)))?;
    let headers: Vec<String> = reader
        .headers()
        .map_err(|e| AppError::Validation(format!("Failed to read CSV headers: {}", e)))?
        .iter()
        .map(String::from)
        .collect();
    let columns = normalize_column_names(&headers);
    let mut rows = Vec::new();

    for record in reader.records() {
        let record =
            record.map_err(|e| AppError::Validation(format!("Failed to read CSV row: {}", e)))?;
        let mut row = BTreeMap::new();
        for (i, value) in record.iter().enumerate() {
            if let Some(column) = columns.get(i) {
                row.insert(column.clone(), serde_json::Value::String(value.to_string()));
            }
        }
        rows.push(row);
    }

    Ok(rows)
}

fn read_json_rows(path: &Path) -> Result<Vec<BTreeMap<String, serde_json::Value>>, AppError> {
    let content = std::fs::read_to_string(path)?;
    let value: serde_json::Value = serde_json::from_str(&content)?;
    json_array_to_rows(value, "JSON")
}

fn read_yaml_rows(path: &Path) -> Result<Vec<BTreeMap<String, serde_json::Value>>, AppError> {
    let content = std::fs::read_to_string(path)?;
    let value: serde_yaml::Value = serde_yaml::from_str(&content)?;
    let json_value = serde_json::to_value(value)?;
    json_array_to_rows(json_value, "YAML")
}

fn json_array_to_rows(
    value: serde_json::Value,
    label: &str,
) -> Result<Vec<BTreeMap<String, serde_json::Value>>, AppError> {
    let array = value.as_array().ok_or_else(|| {
        AppError::Validation(format!(
            "{} import expects a top-level array/list of objects",
            label
        ))
    })?;

    let mut raw_keys = Vec::new();
    for item in array {
        let object = item.as_object().ok_or_else(|| {
            AppError::Validation(format!(
                "{} import expects every row to be an object/mapping",
                label
            ))
        })?;
        for key in object.keys() {
            if !raw_keys.contains(key) {
                raw_keys.push(key.clone());
            }
        }
    }

    let normalized = normalize_column_names(&raw_keys);
    let key_map: BTreeMap<String, String> = raw_keys.into_iter().zip(normalized).collect();
    let mut rows = Vec::new();

    for item in array {
        let object = item.as_object().expect("validated above");
        let mut row = BTreeMap::new();
        for (raw_key, value) in object {
            if let Some(column) = key_map.get(raw_key) {
                row.insert(column.clone(), value.clone());
            }
        }
        rows.push(row);
    }

    Ok(rows)
}

fn write_rows_to_sqlite(
    output_path: &Path,
    table_name: &str,
    rows: &[BTreeMap<String, serde_json::Value>],
) -> Result<(), AppError> {
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let conn = Connection::open(output_path)?;
    let columns = collect_columns(rows);
    if columns.is_empty() {
        return Err(AppError::Validation(
            "Imported rows do not contain any columns".to_string(),
        ));
    }

    let column_defs: Vec<String> = columns
        .iter()
        .map(|column| {
            format!(
                "{} {}",
                quote_identifier(column),
                sqlite_type_for_column(rows, column)
            )
        })
        .collect();
    conn.execute(
        &format!(
            "CREATE TABLE {} ({})",
            quote_identifier(table_name),
            column_defs.join(", ")
        ),
        [],
    )?;

    let placeholders = vec!["?"; columns.len()].join(", ");
    let insert_sql = format!(
        "INSERT INTO {} ({}) VALUES ({})",
        quote_identifier(table_name),
        columns
            .iter()
            .map(|column| quote_identifier(column))
            .collect::<Vec<_>>()
            .join(", "),
        placeholders
    );

    let mut stmt = conn.prepare(&insert_sql)?;
    for row in rows {
        let values: Vec<rusqlite::types::Value> = columns
            .iter()
            .map(|column| json_value_to_sqlite(row.get(column)))
            .collect();
        stmt.execute(rusqlite::params_from_iter(values))?;
    }

    Ok(())
}

fn collect_columns(rows: &[BTreeMap<String, serde_json::Value>]) -> Vec<String> {
    let mut columns = Vec::new();
    for row in rows {
        for key in row.keys() {
            if !columns.contains(key) {
                columns.push(key.clone());
            }
        }
    }
    columns
}

fn sqlite_type_for_column(
    rows: &[BTreeMap<String, serde_json::Value>],
    column: &str,
) -> &'static str {
    let mut inferred = InferredType::Integer;

    for row in rows {
        let Some(value) = row.get(column) else {
            continue;
        };
        if is_empty(value) {
            continue;
        }
        match infer_value_type(value) {
            InferredType::Text => return "TEXT",
            InferredType::Real => inferred = InferredType::Real,
            InferredType::Integer => {}
        }
    }

    match inferred {
        InferredType::Integer => "INTEGER",
        InferredType::Real => "REAL",
        InferredType::Text => "TEXT",
    }
}

/// True only if `s` is a canonical integer literal (round-trips exactly).
/// Rejects leading zeros ("007"), leading '+', and whitespace-padded forms.
fn canonical_i64(s: &str) -> Option<i64> {
    s.parse::<i64>().ok().filter(|i| i.to_string() == s)
}

/// True only if `s` is a canonical float literal (round-trips exactly).
/// Preserves forms like "1.50" that would lose trailing zeros.
fn canonical_f64(s: &str) -> Option<f64> {
    s.parse::<f64>().ok().filter(|f| f.to_string() == s)
}

fn infer_value_type(value: &serde_json::Value) -> InferredType {
    match value {
        serde_json::Value::Number(n) => {
            if n.is_i64() || n.is_u64() {
                InferredType::Integer
            } else {
                InferredType::Real
            }
        }
        serde_json::Value::Bool(_) => InferredType::Integer,
        serde_json::Value::String(s) => {
            let trimmed = s.trim();
            if canonical_i64(trimmed).is_some() {
                InferredType::Integer
            } else if canonical_f64(trimmed).is_some() {
                InferredType::Real
            } else {
                InferredType::Text
            }
        }
        serde_json::Value::Null => InferredType::Integer,
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => InferredType::Text,
    }
}

fn json_value_to_sqlite(value: Option<&serde_json::Value>) -> rusqlite::types::Value {
    let Some(value) = value else {
        return rusqlite::types::Value::Null;
    };
    match value {
        serde_json::Value::Null => rusqlite::types::Value::Null,
        serde_json::Value::Bool(v) => rusqlite::types::Value::Integer(i64::from(*v)),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                rusqlite::types::Value::Integer(i)
            } else if let Some(u) = n.as_u64() {
                if u <= i64::MAX as u64 {
                    rusqlite::types::Value::Integer(u as i64)
                } else {
                    rusqlite::types::Value::Real(u as f64)
                }
            } else if let Some(f) = n.as_f64() {
                rusqlite::types::Value::Real(f)
            } else {
                rusqlite::types::Value::Null
            }
        }
        serde_json::Value::String(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                rusqlite::types::Value::Null
            } else if let Some(i) = canonical_i64(trimmed) {
                rusqlite::types::Value::Integer(i)
            } else if let Some(f) = canonical_f64(trimmed) {
                rusqlite::types::Value::Real(f)
            } else {
                rusqlite::types::Value::Text(s.clone())
            }
        }
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
            rusqlite::types::Value::Text(value.to_string())
        }
    }
}

fn is_empty(value: &serde_json::Value) -> bool {
    matches!(value, serde_json::Value::Null)
        || matches!(value, serde_json::Value::String(s) if s.trim().is_empty())
}

fn normalize_column_names(raw_columns: &[String]) -> Vec<String> {
    let mut seen: BTreeMap<String, usize> = BTreeMap::new();
    raw_columns
        .iter()
        .enumerate()
        .map(|(index, raw)| {
            let fallback;
            let raw_name = if raw.trim().is_empty() {
                fallback = format!("column_{}", index + 1);
                fallback.as_str()
            } else {
                raw
            };
            let base = sanitize_identifier(raw_name);
            let count = seen.entry(base.clone()).or_insert(0);
            *count += 1;
            if *count == 1 {
                base
            } else {
                format!("{}_{}", base, count)
            }
        })
        .collect()
}

fn sanitize_identifier(raw: &str) -> String {
    let mut ident = String::new();
    for ch in raw.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            ident.push(ch.to_ascii_lowercase());
        } else if ch == '_' || ch == '-' || ch.is_whitespace() {
            ident.push('_');
        }
    }

    let ident = ident.trim_matches('_').to_string();
    let ident = if ident.is_empty() {
        "imported_data".to_string()
    } else {
        ident
    };

    if ident
        .chars()
        .next()
        .map(|ch| ch.is_ascii_digit())
        .unwrap_or(false)
    {
        format!("col_{}", ident)
    } else {
        ident
    }
}

fn imports_dir() -> Result<PathBuf, AppError> {
    let path = crate::paths::user_home().join(".alchemist").join("imports");
    std::fs::create_dir_all(&path)?;
    Ok(path)
}

fn count_tables(conn: &Connection) -> Result<usize, AppError> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        [],
        |row| row.get(0),
    )?;
    Ok(count as usize)
}

fn get_columns_for_table(conn: &Connection, table: &str) -> Result<Vec<ColumnSchema>, AppError> {
    let sql = format!("PRAGMA table_info({})", quote_string_literal(table));
    let mut stmt = conn.prepare(&sql)?;

    let mut columns = Vec::new();
    let rows = stmt.query_map([], |row| {
        Ok(ColumnSchema {
            name: row.get(1)?,
            declared_type: row.get::<_, String>(2).unwrap_or_default(),
            nullable: row.get::<_, bool>(3)?,
            is_primary_key: row.get::<_, bool>(5)?,
            default_value: row.get(4).ok(),
            foreign_key_target: None,
        })
    })?;

    for row in rows {
        columns.push(row?);
    }

    // Get foreign keys
    let fk_sql = format!("PRAGMA foreign_key_list({})", quote_string_literal(table));
    if let Ok(mut fk_stmt) = conn.prepare(&fk_sql) {
        if let Ok(fk_rows) = fk_stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(3).unwrap_or_default(), // from column
                format!(
                    "{}.{}",
                    row.get::<_, String>(2).unwrap_or_default(), // table
                    row.get::<_, String>(4).unwrap_or_default()  // to column
                ),
            ))
        }) {
            for fk in fk_rows.flatten() {
                if let Some(col) = columns.iter_mut().find(|c| c.name == fk.0) {
                    col.foreign_key_target = Some(fk.1.clone());
                }
            }
        }
    }

    Ok(columns)
}

fn get_sample_rows(
    conn: &Connection,
    table: &str,
    columns: &[ColumnSchema],
) -> Result<Vec<serde_json::Map<String, serde_json::Value>>, AppError> {
    let col_count = columns.len();
    if col_count == 0 {
        return Ok(Vec::new());
    }

    let mut stmt = conn.prepare(&format!(
        "SELECT * FROM {} LIMIT 2",
        quote_identifier(table)
    ))?;
    let rows = stmt.query_map([], |row| {
        let mut sample = serde_json::Map::new();
        for (i, column) in columns.iter().enumerate().take(col_count) {
            let val: rusqlite::types::Value = row.get_unwrap(i);
            sample.insert(column.name.clone(), sqlite_value_to_json(val));
        }
        Ok(sample)
    })?;

    let mut samples = Vec::new();
    for row in rows {
        samples.push(row?);
    }
    Ok(samples)
}

fn sqlite_value_to_json(value: rusqlite::types::Value) -> serde_json::Value {
    match value {
        rusqlite::types::Value::Null => serde_json::Value::Null,
        rusqlite::types::Value::Integer(i) => serde_json::Value::Number(i.into()),
        rusqlite::types::Value::Real(f) => serde_json::Number::from_f64(f)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        rusqlite::types::Value::Text(t) => serde_json::Value::String(t),
        rusqlite::types::Value::Blob(_) => serde_json::Value::String("[BLOB]".to_string()),
    }
}

fn quote_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

fn quote_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_temp_file(name: &str, content: &str) -> String {
        let dir = std::env::temp_dir().join(format!(
            "alchemist-import-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let path = dir.join(name);
        std::fs::write(&path, content).expect("write temp file");
        path.to_string_lossy().to_string()
    }

    #[test]
    fn imports_csv_as_queryable_sqlite() {
        let source = write_temp_file(
            "potions.csv",
            "name,price_gold,in_stock\nMoon Tonic,75,true\nAsh Balm,25,false\n",
        );

        let sqlite_path = import_tabular_file(&source).expect("import csv");
        let schema = get_schema(&sqlite_path).expect("schema");
        assert_eq!(schema[0].name, "potions");
        assert_eq!(schema[0].row_count, Some(2));

        let result = run_query(
            &sqlite_path,
            "SELECT name FROM potions WHERE price_gold > 50 LIMIT 100",
        )
        .expect("query");
        assert_eq!(result.row_count, 1);
        assert_eq!(
            result.rows[0][0],
            serde_json::Value::String("Moon Tonic".to_string())
        );
    }

    #[test]
    fn imports_json_array_as_queryable_sqlite() {
        let source = write_temp_file(
            "witches.json",
            r#"[{"name":"Mira","age":34},{"name":"Sol","age":29}]"#,
        );

        let sqlite_path = import_tabular_file(&source).expect("import json");
        let result = run_query(
            &sqlite_path,
            "SELECT COUNT(*) AS count FROM witches WHERE age >= 30 LIMIT 100",
        )
        .expect("query");
        assert_eq!(result.rows[0][0], serde_json::Value::Number(1.into()));
    }

    #[test]
    fn imports_yaml_list_as_queryable_sqlite() {
        let source = write_temp_file(
            "artifacts.yaml",
            "- name: Ember Lens\n  power: 8\n- name: Glass Key\n  power: 4\n",
        );

        let sqlite_path = import_tabular_file(&source).expect("import yaml");
        let schema = get_schema(&sqlite_path).expect("schema");
        assert_eq!(schema[0].columns[0].name, "name");

        let result = run_query(
            &sqlite_path,
            "SELECT name FROM artifacts ORDER BY power DESC LIMIT 100",
        )
        .expect("query");
        assert_eq!(
            result.rows[0][0],
            serde_json::Value::String("Ember Lens".to_string())
        );
    }

    #[test]
    fn canonical_i64_rejects_non_forms() {
        assert_eq!(canonical_i64("007"), None); // leading zero — data loss
        assert_eq!(canonical_i64("+5"), None); // leading plus — data loss
        assert_eq!(canonical_i64(" 42"), None); // whitespace-padded — data loss
        assert_eq!(canonical_i64("42 "), None); // trailing whitespace
        assert_eq!(canonical_i64("abc"), None); // non-numeric
        assert_eq!(canonical_i64(""), None); // empty
    }

    #[test]
    fn canonical_i64_accepts_canonical() {
        assert_eq!(canonical_i64("42"), Some(42));
        assert_eq!(canonical_i64("-5"), Some(-5));
        assert_eq!(canonical_i64("0"), Some(0));
    }

    #[test]
    fn import_preserves_leading_zero_strings() {
        let source = write_temp_file(
            "agents.csv",
            "id,name,code\n007,Bond,secret\n42,Holmes,detective\n",
        );
        let sqlite_path = import_tabular_file(&source).expect("import csv");
        let result = run_query(
            &sqlite_path,
            "SELECT code FROM agents WHERE id = '007' LIMIT 100",
        )
        .expect("query");
        assert_eq!(result.row_count, 1);
        // "007" must survive as a string, not be coerced to integer 7
        assert_eq!(
            result.rows[0][0],
            serde_json::Value::String("secret".to_string())
        );
    }

    #[test]
    fn validate_db_path_accepts_valid_extensions_and_dirs() {
        assert!(validate_db_path(Path::new("/some/path/data.db")).is_ok());
        assert!(validate_db_path(Path::new("/some/path/data.sqlite")).is_ok());
        assert!(validate_db_path(Path::new("/some/path/data.sqlite3")).is_ok());
        assert!(validate_db_path(Path::new("/SOME/PATH/DATA.DB")).is_ok());

        let temp_file = std::env::temp_dir().join("test_without_ext");
        assert!(validate_db_path(&temp_file).is_ok());

        let alchemist_file = crate::paths::user_home()
            .join(".alchemist")
            .join("test_without_ext");
        assert!(validate_db_path(&alchemist_file).is_ok());
    }

    #[test]
    fn validate_db_path_handles_uri_parameters_and_schemes() {
        assert!(validate_db_path(Path::new("file:///some/path/data.db?mode=ro")).is_ok());
        assert!(validate_db_path(Path::new("/some/path/data.sqlite?mode=ro&immutable=1")).is_ok());
    }

    #[test]
    fn validate_db_path_handles_relative_and_uri_paths() {
        assert!(validate_db_path(Path::new("file:///some/path/data.db?mode=ro")).is_ok());
        assert!(validate_db_path(Path::new("relative/path/test.sqlite")).is_ok());
        assert!(validate_db_path(Path::new("my_database.db")).is_ok());
    }

    #[test]
    fn validate_db_path_rejects_unauthorized_paths_without_valid_ext() {
        let bad_path = Path::new("/etc/passwd");
        assert!(validate_db_path(bad_path).is_err());

        let bad_txt = Path::new("/home/user/secret.txt");
        assert!(validate_db_path(bad_txt).is_err());

        let bad_uri = Path::new("file:///etc/passwd?mode=ro");
        assert!(validate_db_path(bad_uri).is_err());
    }

    #[test]
    fn validate_db_path_rejects_invalid_file_paths() {
        let bad_path = Path::new("/etc/passwd");
        assert!(validate_db_path(bad_path).is_err());

        let bad_txt = Path::new("/home/user/secret.txt");
        assert!(validate_db_path(bad_txt).is_err());

        let bad_uri = Path::new("file:///etc/passwd?mode=ro");
        assert!(validate_db_path(bad_uri).is_err());
    }

    #[test]
    fn open_vault_rejects_nonexistent_and_invalid_paths() {
        let nonexistent = "/tmp/nonexistent_db_12345.db";
        let err = open_vault(nonexistent).unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));

        let bad_file = std::env::current_dir().unwrap().join("unauthorized.txt");
        std::fs::write(&bad_file, "secret content").unwrap();
        let err = open_vault(&bad_file.to_string_lossy()).unwrap_err();
        let _ = std::fs::remove_file(&bad_file);
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn open_connection_rejects_unpermitted_extension_outside_allowed_dirs() {
        let non_temp = std::env::current_dir().unwrap().join("test_file.txt");
        let err = validate_db_path(&non_temp).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }
}
