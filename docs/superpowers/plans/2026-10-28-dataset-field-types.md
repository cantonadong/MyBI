# Dataset field editing implementation plan

Goal: Edit every dataset field type with explicit save/cancel.
Architecture: Server converts Parquet in bounded batches using existing import conversion rules, publishes a new snapshot with optimistic version checking. Browser submits settings only and renders ten server-returned rows.
Tech stack: Existing FastAPI, PyArrow, React and Vitest.
Spec: docs/superpowers/specs/2026-10-28-dataset-field-types-design.md
Constraints: No dependency; no browser data conversion; no UI explanation of processing location.
Review focus: Invalid values beyond preview; stale versions; null/empty values; preservation of metadata and unmodified columns; cancellation must perform no writes.

- [x] Backend: failing API tests for batch field updates, full-data validation and version conflicts; implement PATCH /datasets/{id}/fields accepting types, formats, version; run backend tests.
- [x] Frontend: failing tests for all-field selects, staged settings, explicit save, cancel/X/Esc and backdrop; replace immediate persistence with one batch request; run Vitest and build.
- [x] Review changed paths and run full checks. Workspace has no git repository, so no worktree or commits apply.

Validation: backend 33 passed; frontend 56 passed; tsc passed; Vite production build passed (--emptyOutDir false because Windows locks dist/assets); browser acceptance passed using installed Edge and isolated temporary database. Conversion reads 65,536-row batches, preserves source snapshots and metadata, and rejects non-finite or incompatible numbers.
