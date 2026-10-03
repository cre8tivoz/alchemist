use sqlparser::ast::Statement;
use sqlparser::dialect::GenericDialect;
use sqlparser::parser::Parser;

use crate::errors::AppError;
use crate::models::{SafetyCheck, ValidatedQuery};

const MAX_ROWS: u64 = 1000;

/// Validate a SQL query for safety. Returns a ValidatedQuery with detailed check results.
pub fn validate_sql(sql: &str) -> Result<ValidatedQuery, AppError> {
    let mut checks = Vec::new();
    let mut final_sql = sql.trim().to_string();
    let mut was_amended = false;
    let mut amendment_note: Option<String> = None;

    // Check 1: Not empty
    if sql.trim().is_empty() {
        return Err(AppError::Validation("SQL query is empty".to_string()));
    }

    // Check 2: Single statement
    let dialect = GenericDialect;
    let statements = Parser::parse_sql(&dialect, sql)
        .map_err(|e| AppError::Validation(format!("SQL parse error: {}", e)))?;

    let single_statement = statements.len() == 1;
    checks.push(SafetyCheck {
        code: "single_statement".to_string(),
        label: "Single SQL statement".to_string(),
        passed: single_statement,
        detail: if single_statement {
            "Exactly 1 statement detected.".to_string()
        } else {
            format!(
                "{} statements detected — only single statements allowed.",
                statements.len()
            )
        },
    });

    if !single_statement {
        return Ok(ValidatedQuery {
            original_sql: sql.to_string(),
            final_sql,
            checks,
            was_amended: false,
            amendment_note: None,
        });
    }

    let stmt = &statements[0];

    // Check 3: SELECT-only
    let is_select = matches!(stmt, Statement::Query { .. });
    checks.push(SafetyCheck {
        code: "select_only".to_string(),
        label: "SELECT-only query".to_string(),
        passed: is_select,
        detail: if is_select {
            "Query is a SELECT or WITH statement.".to_string()
        } else {
            "Only SELECT and WITH queries are allowed. Write operations are blocked.".to_string()
        },
    });

    if !is_select {
        return Ok(ValidatedQuery {
            original_sql: sql.to_string(),
            final_sql,
            checks,
            was_amended: false,
            amendment_note: None,
        });
    }

    // Check 4: Dangerous keywords
    // Historically this was a substring scan (causing false positives on valid
    // identifiers like "releases" or "attachment"). Replaced with a no-op check:
    // Check 3 (select_only) already guarantees the statement is a SELECT/WITH, so
    // PRAGMA, ATTACH, DDL and DML are already rejected by the AST.
    checks.push(SafetyCheck {
        code: "dangerous_keywords".to_string(),
        label: "No dangerous keywords detected".to_string(),
        passed: true,
        detail: "No blocked keywords present.".to_string(),
    });

    // Check 5: LIMIT clause
    let has_limit = match stmt {
        Statement::Query(q) => q.limit.is_some(),
        _ => false,
    };
    if !has_limit {
        was_amended = true;
        // Reconstruct query from parsed AST so trailing comments or semicolons
        // do not comment out or neutralize the auto-appended LIMIT clause.
        let clean_sql = stmt.to_string();
        final_sql = format!("{} LIMIT {}", clean_sql, MAX_ROWS);
        amendment_note = Some(format!(
            "No LIMIT clause found. Added LIMIT {} automatically.",
            MAX_ROWS
        ));
    }

    checks.push(SafetyCheck {
        code: "limit".to_string(),
        label: "LIMIT clause present".to_string(),
        passed: has_limit || was_amended,
        detail: if has_limit {
            "Query already has a LIMIT clause.".to_string()
        } else {
            format!("LIMIT {} was added automatically.", MAX_ROWS)
        },
    });

    Ok(ValidatedQuery {
        original_sql: sql.to_string(),
        final_sql,
        checks,
        was_amended,
        amendment_note,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check_passed(v: &ValidatedQuery, code: &str) -> bool {
        v.checks
            .iter()
            .find(|c| c.code == code)
            .map(|c| c.passed)
            .unwrap_or(false)
    }

    #[test]
    fn allows_simple_select() {
        let v = validate_sql("SELECT * FROM users LIMIT 10").expect("ok");
        assert!(check_passed(&v, "select_only"));
        assert!(check_passed(&v, "single_statement"));
        assert!(check_passed(&v, "limit"));
        assert!(!v.was_amended);
    }

    #[test]
    fn allows_select_from_releases_regression() {
        // Previously blocked by the "RELEASE" keyword substring scan.
        let v = validate_sql("SELECT * FROM releases").expect("ok");
        assert!(check_passed(&v, "select_only"));
        assert!(check_passed(&v, "dangerous_keywords"));
        assert!(v.was_amended);
    }

    #[test]
    fn allows_select_attachment_from_docs_regression() {
        // Previously blocked by the "ATTACH" keyword substring scan.
        let v = validate_sql("SELECT attachment FROM docs LIMIT 5").expect("ok");
        assert!(check_passed(&v, "select_only"));
        assert!(check_passed(&v, "dangerous_keywords"));
        assert!(!v.was_amended);
    }

    #[test]
    fn allows_with_cte() {
        let v = validate_sql("WITH x AS (SELECT 1) SELECT * FROM x").expect("ok");
        assert!(check_passed(&v, "select_only"));
        assert!(check_passed(&v, "single_statement"));
    }

    #[test]
    fn blocks_insert() {
        let v = validate_sql("INSERT INTO t VALUES (1)").expect("err returned as validation");
        assert!(!check_passed(&v, "select_only"));
    }

    #[test]
    fn blocks_update() {
        let v = validate_sql("UPDATE t SET a=1").expect("err returned as validation");
        assert!(!check_passed(&v, "select_only"));
    }

    #[test]
    fn blocks_delete() {
        let v = validate_sql("DELETE FROM t").expect("err returned as validation");
        assert!(!check_passed(&v, "select_only"));
    }

    #[test]
    fn blocks_drop_table() {
        let v = validate_sql("DROP TABLE t").expect("err returned as validation");
        assert!(!check_passed(&v, "select_only"));
    }

    #[test]
    fn blocks_create_table() {
        let v = validate_sql("CREATE TABLE t (a int)").expect("err returned as validation");
        assert!(!check_passed(&v, "select_only"));
    }

    #[test]
    fn blocks_multi_statement() {
        let v = validate_sql("SELECT 1; SELECT 2").expect("err returned as validation");
        assert!(!check_passed(&v, "single_statement"));
    }

    #[test]
    fn auto_limit_added_when_missing() {
        let v = validate_sql("SELECT * FROM t").expect("ok");
        assert!(v.was_amended);
        assert!(v.final_sql.ends_with("LIMIT 1000"));
    }

    #[test]
    fn auto_limit_not_added_when_present() {
        let v = validate_sql("SELECT * FROM t LIMIT 5").expect("ok");
        assert!(!v.was_amended);
        assert_eq!(v.final_sql, "SELECT * FROM t LIMIT 5");
    }

    #[test]
    fn auto_limit_added_when_limit_substring_in_identifiers_or_literals() {
        // Words like 'unlimited', 'delimiter', 'delimited' contain 'LIMIT' substring
        // but do not contain a SQL LIMIT clause. AST check must correctly identify missing LIMIT.
        let v =
            validate_sql("SELECT * FROM unlimited_items WHERE delimiter = 'limited'").expect("ok");
        assert!(v.was_amended);
        assert!(v.final_sql.ends_with("LIMIT 1000"));
    }

    #[test]
    fn auto_limit_strips_trailing_comments_and_enforces_limit() {
        // Trailing single line comment '--' or ';' must not comment out or neutralize auto-appended LIMIT
        let v1 = validate_sql("SELECT * FROM users -- comment").expect("ok");
        assert!(v1.was_amended);
        assert_eq!(v1.final_sql, "SELECT * FROM users LIMIT 1000");

        let v2 = validate_sql("SELECT * FROM users; -- comment").expect("ok");
        assert!(v2.was_amended);
        assert_eq!(v2.final_sql, "SELECT * FROM users LIMIT 1000");
    }
}
