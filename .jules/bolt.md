# Bolt's Journal - Critical Learnings

## 2025-05-18 - Schwartzian Transform for Table Sorting Performance
**Learning:** Sorting table rows in React directly in `.sort((a, b) => ...)` with string formatting or type conversions (`String(val)`) causes O(N log N) allocations and string conversions per sort pass. Pre-extracting sort keys via Schwartzian transform reduces key conversions to O(N).
**Action:** When sorting arrays of row objects or tuple arrays in React, pre-extract sort keys once before `.sort()`.

## 2025-05-19 - Early Termination Cardinality Scanning for Dynamic Chart Detection
**Learning:** When scanning tabular data columns to compute unique value cardinality (e.g., checking if a string column has <= 20 unique values for chart rendering), calling `new Set(rows.map(...))` scans all N rows and allocates a full intermediate array per column. Using an explicit loop that breaks early once `set.size > threshold` avoids both intermediate array allocations and scanning beyond threshold rows (reducing O(N) to O(1) for high cardinality columns).
**Action:** Always break early when building sets for threshold-based cardinality checks on dataset rows.
