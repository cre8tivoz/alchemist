use regex::Regex;

use crate::models::{MemPalaceStructure, TableSchema};

/// Build a prompt for LLM query generation based on the data source type.
pub fn build_sql_prompt(
    question: &str,
    schema_context: &[TableSchema],
    _max_tables: usize,
) -> String {
    let schema_compact = format_schema_context(schema_context);
    let table_names: Vec<&str> = schema_context.iter().map(|t| t.name.as_str()).collect();
    let table_list = table_names.join(", ");

    format!(
        r#"You are an SQLite expert assistant. Write a read-only SELECT query that answers the user's question.

=== CRITICAL RULES — YOU MUST FOLLOW THESE (VIOLATION = FAILURE) ===
1. Use ONLY the exact table names and column names listed in the DATABASE SCHEMA below.
2. NEVER output placeholders like [Table Name], [Column Name], <table_name>, Table Name, etc.
3. The schema below is the COMPLETE list of tables and columns. If a table or column is not listed, it does not exist.
4. Return ONLY the raw SQL query. No explanations, no markdown, no backticks, no code fences.
5. Always end with LIMIT 100.
6. Never use any DML or DDL keywords.
7. DO NOT invent column names, aliases may only be derived from real expressions.
8. For COUNT/SUM/AVG/MIN/MAX or WHERE clauses, first choose a real table and a real listed column. If the requested metric or filter has no matching table/column, return: SELECT 'Question cannot be answered from the available schema' AS answer LIMIT 100;

=== AVAILABLE TABLES (use only these) ===
{}

=== DATABASE SCHEMA WITH SAMPLE ROWS (use only these exact names) ===
{}

=== EXAMPLES OF CORRECT vs INCORRECT === 

Example 1:
Question: Find all documents containing "graham miller"
Tables: embeddings, embedding_metadata, documents, collections
Correct: SELECT e.id, e.document_id, d.content FROM embeddings e JOIN documents d ON e.document_id = d.id WHERE d.content LIKE '%graham miller%' LIMIT 100;
Wrong: SELECT * FROM [Table Name] WHERE [Column Name] = 'graham miller';

Example 2:
Question: List all collections and their document counts
Tables: collections, documents, embeddings
Correct: SELECT c.name, COUNT(d.id) AS doc_count FROM collections c LEFT JOIN documents d ON c.id = d.collection_id GROUP BY c.name LIMIT 100;
Wrong: SELECT name, COUNT(*) FROM [<table_name>] GROUP BY name;

=== TASK ===
User question (use ONLY the tables and columns listed above):
{}

Your SQL query: "#,
        table_list, schema_compact, question
    )
}

/// Build a prompt for ChromaDB vector/text search.
pub fn build_vector_search_prompt(
    question: &str,
    collection_context: &str,
    available_keys: &[String],
) -> String {
    let keys_str = if available_keys.is_empty() {
        "wing, room, hall, entities, source_file, added_by".to_string()
    } else {
        available_keys.join(", ")
    };

    format!(
        r#"You are a semantic search expert. Given the user's question, generate search terms and metadata filters to find relevant documents in a ChromaDB vector database.

Available metadata keys: {}
Collection context: {}

Return your response in this format:
SEARCH_TERMS: <comma-separated list of key search terms>
FILTERS: <key=value pairs, one per line, or "none" if no filters apply>

User question: {}
"#,
        keys_str, collection_context, question
    )
}

/// Build a prompt for MemPalace YAML structure queries.
pub fn build_yaml_query_prompt(question: &str, palace_context: &MemPalaceStructure) -> String {
    let wings_preview: Vec<String> = palace_context
        .wings
        .iter()
        .map(|w| {
            let rooms: Vec<String> = w
                .rooms
                .iter()
                .map(|r| {
                    let keywords = r.keywords.join(", ");
                    let entities = r.entities.join(", ");
                    let drawer_count = r.drawer_count.unwrap_or(r.drawers.len());
                    format!(
                        "    - {} (keywords: {}, entities: {}, drawers: {})",
                        r.name, keywords, entities, drawer_count
                    )
                })
                .collect();
            format!(
                "  {} (path: {:?}, rooms: {})",
                w.name,
                w.path,
                rooms.join("\n")
            )
        })
        .collect();

    let palace_str = wings_preview.join("\n");

    format!(
        r#"You are a MemPalace structure expert. Given the palace hierarchy below, answer the user's question about its structure.

Palace structure:
{}

Answer concisely based on the structure above. If the answer requires navigating specific wings/rooms/drawers, list the path.

User question: {}
"#,
        palace_str, question
    )
}

/// Parse SQL from an LLM response — extracts ```sql blocks or plain text.
/// Returns None if the response contains placeholder patterns (e.g. [Table Name]).
pub fn parse_sql_from_response(response: &str) -> Option<String> {
    // Try ```sql ... ``` block first
    let sql_block_re = Regex::new(r"(?s)```sql\s*\n?(.*?)```").ok()?;
    if let Some(caps) = sql_block_re.captures(response) {
        let sql = caps.get(1).unwrap().as_str().trim().to_string();
        if !sql.is_empty() && !contains_placeholder(&sql) {
            return Some(sql);
        }
    }

    // Try any ``` ... ``` block
    let code_block_re = Regex::new(r"(?s)```\s*\n?(.*?)```").ok()?;
    if let Some(caps) = code_block_re.captures(response) {
        let sql = caps.get(1).unwrap().as_str().trim().to_string();
        if !sql.is_empty() && !contains_placeholder(&sql) {
            return Some(sql);
        }
    }

    // Fallback: return the entire response, trimmed — but strip backticks if present
    let trimmed = response.trim();
    let cleaned = trimmed.trim_start_matches('`').trim_end_matches('`').trim();
    if !cleaned.is_empty() && !contains_placeholder(cleaned) {
        Some(cleaned.to_string())
    } else {
        None
    }
}

/// Check if SQL contains placeholder patterns that indicate a bad response.
fn contains_placeholder(sql: &str) -> bool {
    // Common placeholder patterns
    if sql.contains("[Table Name]") || sql.contains("[Column Name]") {
        return true;
    }
    if sql.contains("<table_name>") || sql.contains("<column_name>") {
        return true;
    }
    if sql.contains("<table>") || sql.contains("<column>") {
        return true;
    }
    // Generic bracketed placeholders like [Some Name]
    let placeholder_re = Regex::new(r"\[[A-Z][a-z]+ [A-Z][a-z]+\]").ok();
    if let Some(re) = placeholder_re {
        if re.is_match(sql) {
            return true;
        }
    }
    false
}

/// Parse search terms from a vector search response.
pub fn parse_search_terms(response: &str) -> Vec<String> {
    let terms_re = Regex::new(r"(?i)SEARCH_TERMS:\s*(.+)").ok();
    if let Some(re) = terms_re {
        if let Some(caps) = re.captures(response) {
            let terms_str = caps.get(1).unwrap().as_str();
            return terms_str
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
        }
    }

    // Fallback: use whole response as one search term
    vec![response.trim().to_string()]
}

/// Detect the best query mode from a user question.
pub fn detect_mode(question: &str) -> &'static str {
    let lower = question.to_lowercase();
    if lower.contains("wing")
        || lower.contains("room")
        || lower.contains("drawer")
        || lower.contains("palace")
        || lower.contains("structure")
        || lower.contains("hierarchy")
        || lower.contains("mempalace")
    {
        "yaml_query"
    } else if lower.contains("search")
        || lower.contains("find")
        || lower.contains("similar")
        || lower.contains("relevant")
        || lower.contains("semantic")
        || lower.contains("about ")
    {
        "vector_search"
    } else {
        "sql"
    }
}

/// Choose query mode from the active data source, falling back to keyword
/// detection when the source type is unknown/absent.
pub fn mode_for_source(source_type: Option<&str>, question: &str) -> &'static str {
    match source_type {
        Some("sqlite") => "sql",
        Some("chromadb") => "vector_search",
        Some("mempalace") => "yaml_query",
        _ => detect_mode(question),
    }
}

// ── Internal helpers ──

/// Format schema as table, column, row count, and sample-row context.
fn format_schema_context(tables: &[TableSchema]) -> String {
    tables
        .iter()
        .map(|t| {
            let cols: Vec<String> = t
                .columns
                .iter()
                .map(|c| {
                    let mut details = if c.declared_type.is_empty() {
                        c.name.clone()
                    } else {
                        format!("{} {}", c.name, c.declared_type)
                    };
                    if c.is_primary_key {
                        details.push_str(" PRIMARY KEY");
                    }
                    if let Some(fk) = &c.foreign_key_target {
                        details.push_str(&format!(" REFERENCES {}", fk));
                    }
                    details
                })
                .collect();
            let row_count = t
                .row_count
                .map(|c| c.to_string())
                .unwrap_or_else(|| "unknown".to_string());
            let sample_rows = t
                .sample_rows
                .as_ref()
                .filter(|rows| !rows.is_empty())
                .and_then(|rows| serde_json::to_string(rows).ok())
                .unwrap_or_else(|| "[]".to_string());

            format!(
                "  Table: {}\n    Row count: {}\n    Columns: {}\n    Sample rows: {}",
                t.name,
                row_count,
                cols.join(", "),
                sample_rows
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqlite_source_overrides_keyword_routing() {
        // "find all witches" would route to vector_search by keyword, but on a
        // SQLite source it must go to SQL.
        assert_eq!(mode_for_source(Some("sqlite"), "find all witches"), "sql");
        // "show the structure" would route to yaml_query by keyword, but on
        // SQLite it must also be SQL.
        assert_eq!(mode_for_source(Some("sqlite"), "show the structure"), "sql");
    }

    #[test]
    fn chromadb_source_routes_to_vector() {
        assert_eq!(
            mode_for_source(Some("chromadb"), "list tables"),
            "vector_search"
        );
    }

    #[test]
    fn mempalace_source_routes_to_yaml() {
        assert_eq!(mode_for_source(Some("mempalace"), "anything"), "yaml_query");
    }

    #[test]
    fn unknown_source_falls_back_to_keyword() {
        // When the source type is unknown/absent, behaviour matches detect_mode.
        assert_eq!(mode_for_source(None, "find documents"), "vector_search");
    }
}
