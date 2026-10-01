# Bolt's Journal - Critical Learnings

## 2025-05-18 - Schwartzian Transform for Table Sorting Performance
**Learning:** Sorting table rows in React directly in `.sort((a, b) => ...)` with string formatting or type conversions (`String(val)`) causes O(N log N) allocations and string conversions per sort pass. Pre-extracting sort keys via Schwartzian transform reduces key conversions to O(N).
**Action:** When sorting arrays of row objects or tuple arrays in React, pre-extract sort keys once before `.sort()`.
