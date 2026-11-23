# Two-step import implementation plan

Spec: docs/superpowers/specs/2026-10-28-import-settings-design.md
Goal: Separate source selection from aligned configuration with cascading numeric formats.
Architecture: Reuse FieldSettings in DatasetPreview and App, existing import preview APIs, backend parsing and snapshot publication. Preserve raw rows through conversion for inference and text overrides.
Review focus: percent ratio conversion exactly once; renamed-field formats; Excel sheet navigation; integer-format legacy records; cancelling/back without writes; five samples for every field.

- [x] Add failing backend inference/persistence tests; infer percent and decimal precision, preserve raw rows, accept validated import formats.
- [x] Add failing React step/cascade/alignment tests; replace separate horizontal preview with shared transposed field table, request five rows for all fields, implement source/back/config screens.
- [x] Build and run isolated CSV/XLS/XLSX, paste/percent/rename/back, field-role and live chart-format browser acceptance. Inspect screenshot.
- [x] Run final suites and attempt to stop identified project services; see data/logs/last-update-stop.txt for process termination results.

Validation: backend 42 passed; frontend 62 passed; TypeScript and production build passed. Paste/percent/rename/back and CSV/XLS/XLSX browser acceptance passed after final build. Field-role and live-chart-format browser checks also passed. Final screenshot inspected. Empty-first-sheet recovery and legacy integer-backed percentage formats have regression checks.
