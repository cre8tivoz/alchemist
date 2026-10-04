# Sentinel Security Journal

## 2025-05-21 - SQLite URI Mode Flag Bypass on Read-Only Connections
**Vulnerability:** Opening SQLite connections using raw file paths or URIs with `OpenFlags::SQLITE_OPEN_URI` allowed query parameters like `?mode=rwc` or `?mode=rw` to override `OpenFlags::SQLITE_OPEN_READ_ONLY`, enabling write queries (`INSERT`, `CREATE TABLE`) on supposedly read-only vault connections.
**Learning:** SQLite URI mode flags parsed from query strings override flags passed to `sqlite3_open_v2` when `SQLITE_OPEN_URI` is enabled.
**Prevention:** Always open database connections using sanitized, un-queried filesystem paths (`extract_clean_path_str`) with strict `OpenFlags::SQLITE_OPEN_READ_ONLY` and without `SQLITE_OPEN_URI`.

## 2025-05-20 - AST Query Reconstruction vs String Concatenation for Safety Clauses
**Vulnerability:** Appending ` LIMIT 1000` to raw SQL query strings (`final_sql.push_str(" LIMIT 1000")`) failed when the user query ended with a single-line comment (`-- comment`). The auto-appended `LIMIT` clause fell inside the comment block and was ignored during SQL execution, bypassing query row limits.
**Learning:** Raw string concatenation on SQL statements containing comments or semicolons can render appended clauses inactive or syntax errors.
**Prevention:** Reconstruct the SQL query string from the parsed AST (`stmt.to_string()`) before appending safety clauses so comments and trailing separators are stripped.

## 2025-05-19 - AST-Based AST Limit Check vs Substring Matching
**Vulnerability:** Substring scanning for `LIMIT` in SQL validation (`contains("LIMIT")`) created false positives on queries containing words like `unlimited`, `delimiter`, or `'limited'`, causing the validator to mistakenly skip appending a safety `LIMIT 1000` clause.
**Learning:** Raw string substring checks on SQL queries are vulnerable to false positives when identifiers or string literals match SQL keyword strings.
**Prevention:** Use AST query node inspection (`match stmt { Statement::Query(q) => q.limit.is_some(), _ => false }`) to reliably verify SQL clauses instead of string substring scanning.

## 2025-05-18 - Atomic File Creation Permissions for Secrets Store
**Vulnerability:** In `secret_store.rs`, `fs::write` created `secrets.json` with standard default permissions before `fs::set_permissions` restricted them to `0o600`. On Unix systems, this created a race condition window where API keys were temporarily readable by other local users on multi-user systems.
**Learning:** `fs::write` or `File::create` relies on system umask and does not set restricted mode atomically upon file creation.
**Prevention:** Use `fs::OpenOptions` with `options.mode(0o600)` on Unix platforms (`std::os::unix::fs::OpenOptionsExt`) so that file creation and permission assignment are atomic. Also synchronize tests operating on shared local storage files using a `Mutex`.
