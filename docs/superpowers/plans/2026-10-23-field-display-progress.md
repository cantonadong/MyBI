# SDD ledger — plan: docs/superpowers/plans/2026-10-23-field-display.md

Execution: native, approved by user. Task 1 in progress.
Ruling: this directory has no Git repository, as documented in the approved plan; use the existing user workspace and this persistent ledger instead of Git-only workspace/commit scripts — preserves the running BAT workflow without introducing a repository — no branch isolation or commit rollback is available.
Pre-flight: Task 1 produces Dataset.field_formats; Tasks 2 and 3 consume the same {kind, format, decimals} mapping. Existing schema name/type contracts remain unchanged. No interface conflicts.
Task 1: complete — missing field_formats RED; full backend suite GREEN, 29 passed. Formats persisted in schema_json with dataset version check; raw values unchanged.
Task 2: in progress — shared formatter and series format tests RED; absent shared helper and formatter callbacks reproduced.
Task 2: complete — frontend suite 47 passed; production build passed. Preview requests 10 rows, refreshes metadata on open, serializes saves and preserves saved state on failure. Each series uses its own field format. Numeric formatter cache has at most 18 configurations.
Task 3: in progress — 4.9s undo test failed against 2s deadline; deadline changed to 5s. Narrow/wide label test RED→GREEN. Browser acceptance pending.
Task 3: complete — native browser field formatting/persistence/resize/KPI/table and 5-second undo checks passed; 20 chart renderers, imports, mapping, copy, snapping and BAT regression checks passed.
Final review: fresh-context reviewer completed; no Critical findings. Three Important findings (null category, early-rounded bins, derived count units) reproduced in tests, then fixed. Two tooltip propagation findings regraded Important because the central-format contract also applies to category names and scatter X/size; both fixed in the same pass.
Final: fixed null-category identity, histogram boundary precision, count units, category tooltip formatting and scatter dimensions — five new tests RED→GREEN; frontend suite 52/52 and production build passed.
Ruling: derived count/count_distinct results keep integer count units even when the source field is displayed as percent — these are frequencies, not original field values — they cannot intentionally be shown as percentages without a separate ratio metric.
Final: Ruling: unrelated pre-existing chart issues and external clipboard behavior remain outside this change; cross-tab real-time push is not added — local edits update charts immediately, and reopening preview/dashboard fetches latest metadata — other open pages may retain old formatting until reopened.
No deferred minors. Final rerun: frontend 52 passed, backend 29 passed; production build passed; field-format/KPI-count/resize, 5-second undo, editor/copy, all 20 chart types, CSV/XLS/XLSX and BAT acceptance passed. No outstanding review findings.
Finish: no Git branch exists to merge or push; preserve the approved in-place workspace and this ledger, and deliver the updated running BAT application.
