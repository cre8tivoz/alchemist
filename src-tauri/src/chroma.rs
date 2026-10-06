use rusqlite::{Connection, OpenFlags};
use std::path::Path;

use crate::errors::AppError;
use crate::models::{CollectionInfo, PalaceDiscovery, PalaceInfo, SearchResult};

/// ChromaDB persistence directory discovery.
/// Searches for a valid chroma.sqlite3 in the given path (or its parent).
pub fn discover_palace(path: &str) -> Result<PalaceDiscovery, AppError> {
    let p = Path::new(path);

    // Try direct path first, then chroma.sqlite3 in that directory
    let db_path = if p.is_file() {
        p.to_path_buf()
    } else if p.is_dir() {
        let candidate = p.join("chroma.sqlite3");
        if candidate.exists() {
            candidate
        } else {
            return Err(AppError::NotFound(format!(
                "No chroma.sqlite3 found in directory: {}",
                path
            )));
        }
    } else {
        return Err(AppError::NotFound(format!("Path not found: {}", path)));
    };

    if !db_path.exists() {
        return Err(AppError::NotFound(format!(
            "chroma.sqlite3 not found at: {}",
            db_path.display()
        )));
    }

    let metadata = std::fs::metadata(&db_path)?;
    let size_bytes = metadata.len();
    let file_name = db_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let parent_dir = db_path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    // Open and count collections
    let conn = open_chroma(&db_path.to_string_lossy())?;
    let collection_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM collections", [], |row| row.get(0))
        .unwrap_or(0);
    let total_docs: i64 = conn
        .query_row("SELECT COUNT(*) FROM embeddings", [], |row| row.get(0))
        .unwrap_or(0);
    let segment_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM segments", [], |row| row.get(0))
        .unwrap_or(0);

    Ok(PalaceDiscovery {
        path: db_path.to_string_lossy().to_string(),
        file_name,
        parent_directory: parent_dir,
        size_bytes,
        collection_count: collection_count as usize,
        total_documents: total_docs as usize,
        segment_count: segment_count as usize,
    })
}

/// List all collections in a ChromaDB persistence directory.
pub fn list_collections(palace_path: &str) -> Result<Vec<CollectionInfo>, AppError> {
    let conn = open_chroma_by_palace_path(palace_path)?;

    // Optimization (⚡ Bolt): Pre-aggregate document counts across all collections in a single GROUP BY
    // query instead of running N individual queries (N+1 query pattern).
    let doc_counts = get_collection_doc_counts(&conn).unwrap_or_default();

    let mut stmt = conn.prepare(
        "SELECT id, name, dimension, COALESCE(config_json_str, '{}')
         FROM collections ORDER BY name",
    )?;

    let collections: Vec<CollectionInfo> = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let name: String = row.get(1)?;
            let dimension: Option<i64> = row.get(2)?;
            let config_json: String = row.get(3)?;

            Ok((id, name, dimension, config_json))
        })?
        .filter_map(|r| r.ok())
        .map(|(id, name, dimension, config_json)| {
            let doc_count = doc_counts.get(&id).copied().unwrap_or(0);
            CollectionInfo {
                id,
                name,
                dimension: dimension.map(|d| d as usize),
                document_count: doc_count,
                config_json,
            }
        })
        .collect();

    Ok(collections)
}

/// Full-text search across all documents in a ChromaDB persistence.
pub fn search_documents(
    palace_path: &str,
    query: &str,
    collection_name: Option<&str>,
    limit: usize,
) -> Result<Vec<SearchResult>, AppError> {
    let conn = open_chroma_by_palace_path(palace_path)?;
    let max_results = limit.min(100);

    // Build the FTS5 search query
    // The embedding_fulltext_search table uses trigram tokenizer
    let fts_query = if query.trim().is_empty() {
        return Ok(Vec::new());
    } else {
        // For trigram tokenizer, wrap in quotes for exact-ish match
        // or just the raw query works for prefix matching
        format!("\"{}\"", query.replace('"', ""))
    };

    // Optimization (⚡ Bolt): Pre-fetch collection segment IDs into a HashSet if collection_name is provided.
    // This allows O(1) filtering *before* running get_embedding_metadata(), eliminating redundant
    // metadata SQL queries and allocations for search results that would otherwise be discarded.
    let seg_filter: Option<std::collections::HashSet<String>> = if let Some(coll_name) =
        collection_name
    {
        if !coll_name.is_empty() {
            let coll_id: Option<String> = conn
                .query_row(
                    "SELECT id FROM collections WHERE name = ?1",
                    rusqlite::params![coll_name],
                    |row| row.get(0),
                )
                .ok();

            if let Some(cid) = coll_id {
                let mut seg_stmt = conn.prepare("SELECT id FROM segments WHERE collection = ?1")?;
                let seg_ids: std::collections::HashSet<String> = seg_stmt
                    .query_map(rusqlite::params![cid], |row| {
                        let id: String = row.get(0)?;
                        Ok(id)
                    })?
                    .filter_map(|r| r.ok())
                    .collect();
                Some(seg_ids)
            } else {
                return Ok(Vec::new());
            }
        } else {
            None
        }
    } else {
        None
    };

    let sql = r#"SELECT
            efs.rowid,
            efs.string_value,
            em.id AS embed_id,
            emb.segment_id,
            emb.created_at
        FROM embedding_fulltext_search efs
        JOIN embedding_metadata em ON em.id = efs.rowid AND em.key = 'chroma:document'
        JOIN embeddings emb ON emb.id = em.id
        WHERE embedding_fulltext_search MATCH ?
        ORDER BY rank
        LIMIT ?"#;

    let mut stmt = conn.prepare(sql)?;
    let results: Vec<SearchResult> = stmt
        .query_map(rusqlite::params![fts_query, max_results as i64], |row| {
            let _fts_rowid: i64 = row.get(0)?;
            let document_text: String = row.get(1)?;
            let embed_id: i64 = row.get(2)?;
            let segment_id: String = row.get(3)?;
            let created_at: String = row.get::<_, String>(4).unwrap_or_default();

            Ok((embed_id, document_text, segment_id, created_at))
        })?
        .filter_map(|r| r.ok())
        .filter(|(_, _, segment_id, _)| {
            if let Some(ref seg_set) = seg_filter {
                seg_set.contains(segment_id)
            } else {
                true
            }
        })
        .map(|(embed_id, doc_text, segment_id, created_at)| {
            // Gather metadata for this embedding only after passing collection filter
            let metadata = get_embedding_metadata(&conn, embed_id).unwrap_or_default();

            let relevance_hint = doc_text.chars().take(200).collect::<String>();

            SearchResult {
                embedding_id: embed_id as usize,
                segment_id,
                document_text: doc_text.chars().take(2000).collect::<String>(),
                metadata,
                relevance_hint: if relevance_hint.len() < 200 {
                    relevance_hint
                } else {
                    format!("{}...", relevance_hint)
                },
                score: None, // FTS5 rank is opaque; vector score comes in Sprint 3
                created_at,
            }
        })
        .collect();

    Ok(results)
}

/// Get palace structure info (basic metadata about the ChromaDB).
pub fn get_palace_info(palace_path: &str) -> Result<PalaceInfo, AppError> {
    let discovery = discover_palace(palace_path)?;
    let collections = list_collections(palace_path)?;

    Ok(PalaceInfo {
        discovery,
        collections,
    })
}

// ---- Internal Helpers ----

fn open_chroma(path: &str) -> Result<Connection, AppError> {
    let clean_str = crate::db::extract_clean_path_str(path);
    crate::db::validate_db_path(Path::new(path))?;
    Ok(Connection::open_with_flags(
        &clean_str,
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?)
}

fn open_chroma_by_palace_path(palace_path: &str) -> Result<Connection, AppError> {
    let p = Path::new(palace_path);
    let db_path = if p.is_file() {
        p.to_path_buf()
    } else {
        p.join("chroma.sqlite3")
    };

    if !db_path.exists() {
        return Err(AppError::NotFound(format!(
            "chroma.sqlite3 not found at: {}",
            db_path.display()
        )));
    }

    open_chroma(&db_path.to_string_lossy())
}

/// Optimization (⚡ Bolt): Pre-aggregate document counts per collection in a single query pass.
fn get_collection_doc_counts(
    conn: &Connection,
) -> Result<std::collections::HashMap<String, usize>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT s.collection, COUNT(DISTINCT e.id)
         FROM embeddings e
         JOIN segments s ON e.segment_id = s.id
         GROUP BY s.collection",
    )?;

    let mut counts = std::collections::HashMap::new();
    let rows = stmt.query_map([], |row| {
        let collection_id: String = row.get(0)?;
        let count: i64 = row.get(1)?;
        Ok((collection_id, count as usize))
    })?;

    for (col_id, count) in rows.flatten() {
        counts.insert(col_id, count);
    }

    Ok(counts)
}

fn get_embedding_metadata(
    conn: &Connection,
    embed_id: i64,
) -> Result<std::collections::HashMap<String, String>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT key, COALESCE(string_value, CAST(int_value AS TEXT), CAST(float_value AS TEXT), '')
         FROM embedding_metadata WHERE id = ?1",
    )?;

    let mut map = std::collections::HashMap::new();
    let rows = stmt.query_map(rusqlite::params![embed_id], |row| {
        let key: String = row.get(0)?;
        let value: String = row.get(1)?;
        Ok((key, value))
    })?;

    for (key, value) in rows.flatten() {
        map.insert(key, value);
    }

    Ok(map)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_chroma_rejects_unauthorized_extension() {
        let bad_file = std::env::current_dir()
            .unwrap()
            .join("unauthorized_chroma.txt");
        std::fs::write(&bad_file, "secret").unwrap();
        let err = open_chroma(&bad_file.to_string_lossy()).unwrap_err();
        let _ = std::fs::remove_file(&bad_file);
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn test_list_collections_and_search_documents() {
        let temp_dir =
            std::env::temp_dir().join(format!("chroma_test_{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let chroma_db = temp_dir.join("chroma.sqlite3");

        let conn = Connection::open(&chroma_db).unwrap();
        conn.execute_batch(
            "CREATE TABLE collections (id TEXT PRIMARY KEY, name TEXT, dimension INTEGER, config_json_str TEXT);
             CREATE TABLE segments (id TEXT PRIMARY KEY, collection TEXT);
             CREATE TABLE embeddings (id INTEGER PRIMARY KEY, segment_id TEXT, created_at TEXT);
             CREATE TABLE embedding_metadata (id INTEGER, key TEXT, string_value TEXT, int_value INTEGER, float_value REAL);
             CREATE VIRTUAL TABLE embedding_fulltext_search USING fts5(string_value, tokenize='trigram');

             INSERT INTO collections VALUES ('col1', 'recipes', 1536, '{}');
             INSERT INTO collections VALUES ('col2', 'notes', 1536, '{}');

             INSERT INTO segments VALUES ('seg1', 'col1');
             INSERT INTO segments VALUES ('seg2', 'col2');

             INSERT INTO embeddings VALUES (1, 'seg1', '2025-01-01');
             INSERT INTO embeddings VALUES (2, 'seg2', '2025-01-01');

             INSERT INTO embedding_metadata VALUES (1, 'chroma:document', 'potion recipe for speed', NULL, NULL);
             INSERT INTO embedding_metadata VALUES (2, 'chroma:document', 'meeting notes about speed', NULL, NULL);

             INSERT INTO embedding_fulltext_search(rowid, string_value) VALUES (1, 'potion recipe for speed');
             INSERT INTO embedding_fulltext_search(rowid, string_value) VALUES (2, 'meeting notes about speed');"
        )
        .unwrap();
        drop(conn);

        let path_str = temp_dir.to_string_lossy().to_string();

        let collections = list_collections(&path_str).expect("list_collections");
        assert_eq!(collections.len(), 2);
        let col1 = collections.iter().find(|c| c.name == "recipes").unwrap();
        assert_eq!(col1.document_count, 1);

        // Search across all collections
        let results_all = search_documents(&path_str, "speed", None, 10).expect("search all");
        assert_eq!(results_all.len(), 2);

        // Search with collection filter
        let results_filtered =
            search_documents(&path_str, "speed", Some("recipes"), 10).expect("search filtered");
        assert_eq!(results_filtered.len(), 1);
        assert_eq!(results_filtered[0].segment_id, "seg1");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
