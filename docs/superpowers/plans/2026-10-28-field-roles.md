# Field roles implementation plan

Goal: Restrict chart roles and simplify field settings.
Spec: docs/superpowers/specs/2026-10-28-field-roles-design.md
Architecture: Reuse existing import inference, conversion, metadata, FieldBindings and DatasetPreview. No new dependencies.
Constraints: Process data on the backend; preserve source snapshots on failure; stop project servers after changes.
Review focus: first row integer with later fraction, legacy boolean/date-time datasets, secondary metric and legend roles, fields beyond preview, cancelling staged edits.

- [x] Add failing field-role and inference tests; unify first-row inference for CSV/TSV and Excel, accept integer conversion with full validation, reject removed target types, validate query roles.
- [x] Add failing UI tests; restrict role candidates/defaults, share labels, separate vertical field settings from five-column preview, preserve transactional save/cancel.
- [x] Run backend/frontend tests, typecheck/build, and isolated browser acceptance; inspect screenshot.
- [ ] Stop existing project backend: Windows denied termination of PID 30304 on port 8000; temporary server on 8013 was stopped. User must rerun the launcher to restart their service.

Validation: 39 backend tests, 59 frontend tests; TypeScript and production build passed. Both field-role and field-format browser acceptance passed with isolated storage; screenshot inspected. Temporary port 8013 stopped. Existing port 8000 process could not be terminated: Windows returned Access is denied.
