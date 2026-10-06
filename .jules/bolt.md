# Bolt's Journal - Critical Learnings

## 2025-05-18 - Schwartzian Transform for Table Sorting Performance
**Learning:** Sorting table rows in React directly in `.sort((a, b) => ...)` with string formatting or type conversions (`String(val)`) causes O(N log N) allocations and string conversions per sort pass. Pre-extracting sort keys via Schwartzian transform reduces key conversions to O(N).
**Action:** When sorting arrays of row objects or tuple arrays in React, pre-extract sort keys once before `.sort()`.

## 2025-05-19 - Early Termination Cardinality Scanning for Dynamic Chart Detection
**Learning:** When scanning tabular data columns to compute unique value cardinality (e.g., checking if a string column has <= 20 unique values for chart rendering), calling `new Set(rows.map(...))` scans all N rows and allocates a full intermediate array per column. Using an explicit loop that breaks early once `set.size > threshold` avoids both intermediate array allocations and scanning beyond threshold rows (reducing O(N) to O(1) for high cardinality columns).
**Action:** Always break early when building sets for threshold-based cardinality checks on dataset rows.

## 2025-05-20 - Prop Lifting for Asynchronous Tauri IPC File Parses
**Learning:** When child components (e.g. `InspectorPanel`) independently call asynchronous IPC backend functions like `parseMempalace` that read and parse files from disk, rendering them inside parent views (e.g. `Workspace`) that already perform the same IPC call leads to duplicate concurrent IPC calls and disk reads. Passing parsed structures down via props eliminates redundant IPC invocations and re-renders.
**Action:** Pass loaded dataset/schema structures as props from parent views rather than re-fetching in sibling/child panels.

## 2025-05-21 - Single-Pass Tabular Schema and Type Inference
**Learning:** Inferring SQLite column types by running a separate full table scan for each column (C columns x N rows) causes C redundant passes and map lookups across rows. Inferring types in a single pass while collecting column names—and short-circuiting as soon as a column reaches `TEXT`—reduces schema determination to O(N).
**Action:** Infer column types and schema metadata in a single pass with early termination for widest types instead of scanning rows per column.

## 2025-05-22 - Batch Group-By Aggregation and Early Filtering in Vector DB Queries
**Learning:** Running individual document count queries per collection in ChromaDB creates an N+1 database query pattern. Using a single `GROUP BY` query aggregates counts in 1 pass. Furthermore, pre-filtering search matches with a `HashSet` of collection segment IDs *before* fetching embedding metadata avoids unnecessary secondary SQL queries and string allocations for non-matching search results.
**Action:** Pre-aggregate relational counts with `GROUP BY` and filter search results with hash sets prior to executing secondary metadata queries.
