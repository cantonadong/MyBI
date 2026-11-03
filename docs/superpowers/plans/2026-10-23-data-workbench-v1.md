# Data Workbench V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a Dockerized file-to-dashboard application that imports pasted, CSV, XLS, and XLSX data; stores immutable Parquet snapshots; and builds persistent ECharts dashboards with scoped filters.

**Architecture:** A React/TypeScript SPA calls a FastAPI service backed by PostgreSQL metadata and DuckDB/Parquet analytical storage. Imports publish snapshots atomically; a validated view-query contract feeds versioned chart adapters and dashboards without exposing arbitrary SQL.

**Tech Stack:** React, TypeScript, Vite, Apache ECharts, react-grid-layout, FastAPI, SQLAlchemy, Alembic, PostgreSQL, DuckDB, PyArrow, python-calamine, pytest, Vitest, Playwright, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-23-data-workbench-v1-design.md`

## Global Constraints

- V1 excludes database connections, SQL editing/execution, scheduling, pipelines, notifications, Trino, distributed workers, SSO, and multi-user authorization.
- Dataset Snapshots are immutable; publish only after parsing and validation succeed.
- Browser APIs accept resource IDs and structured filter expressions, never server paths or arbitrary SQL.
- PostgreSQL stores metadata; Parquet stores Dataset rows; DuckDB performs server-side query work.
- CSV, XLS, XLSX, and pasted table text are required inputs.
- The browser must not receive a complete large Dataset for charting or tabular browsing.
- ChartConfig is versioned and independent of raw ECharts options.
- Docker volumes must preserve metadata and snapshots across restart.

## Review Focus

- Empty files, duplicate/blank headers, and zero-row sheets fail with actionable validation rather than publishing a Snapshot.
- CSV values containing delimiters/newlines and pasted TSV containing quoted text retain exact cell boundaries.
- Excel date serials, booleans, formula cells without cached values, and multiple worksheets produce explicit preview metadata.
- Null, empty string, numeric zero, and `0.1234` survive round-trip and formatting without mutation.
- Interrupted import, duplicate confirmation, stale resource version, and deleted/missing Snapshot cannot expose partial data or overwrite newer state.

---

### Task 1: Repository and service skeleton

**Files:**
- Create: `compose.yaml`
- Create: `.env.example`
- Create: `Makefile`
- Create: `backend/pyproject.toml`
- Create: `backend/app/main.py`
- Create: `backend/app/settings.py`
- Create: `backend/tests/test_health.py`
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/App.test.tsx`

**Interfaces:**
- Produces: `GET /api/health -> {"status":"ok"}` and runnable frontend/backend/PostgreSQL services.

- [ ] **Step 1: Write failing backend and frontend smoke tests** asserting the health payload and rendered `Data Workbench` application shell.
- [ ] **Step 2: Run `cd backend; uv run pytest tests/test_health.py -q` and `cd frontend; npm test -- --run`**; verify failure because entry points do not exist.
- [ ] **Step 3: Add the smallest FastAPI and Vite/React skeleton plus Docker Compose health checks**; pin dependencies in lockfiles and expose only application, API, and PostgreSQL services.
- [ ] **Step 4: Run both smoke tests and `docker compose config`**; expect all exit 0.
- [ ] **Step 5: Commit** with `feat: scaffold data workbench services`.

### Task 2: Metadata schema and immutable publication

**Files:**
- Create: `backend/alembic.ini`
- Create: `backend/alembic/env.py`
- Create: `backend/alembic/versions/0001_core_resources.py`
- Create: `backend/app/db.py`
- Create: `backend/app/models.py`
- Create: `backend/app/repositories/datasets.py`
- Create: `backend/tests/test_dataset_repository.py`

**Interfaces:**
- Produces: `Dataset`, `DatasetSnapshot`, `ImportRun`, `Chart`, `Filter`, `Dashboard`, `DashboardChart`, and `DashboardFilter` persistence models.
- Produces: `publish_snapshot(session, dataset_id, candidate) -> DatasetSnapshot` that atomically creates a successful immutable Snapshot and advances `Dataset.current_snapshot_id`.

- [ ] **Step 1: Write repository tests** for first publication, later version publication, failed candidate rollback, immutable Snapshot fields, shared Dataset references, and optimistic version conflicts.
- [ ] **Step 2: Run the repository test file against PostgreSQL**; verify missing schema/repository failures.
- [ ] **Step 3: Implement the migration, models, and minimal repository functions** using generated UUIDs, foreign keys, uniqueness constraints, timestamps, and integer resource versions.
- [ ] **Step 4: Run repository tests and migration upgrade/downgrade/upgrade**; expect all exit 0.
- [ ] **Step 5: Commit** with `feat: add versioned metadata model`.

### Task 3: Tabular parsing and schema confirmation

**Files:**
- Create: `backend/app/imports/types.py`
- Create: `backend/app/imports/delimited.py`
- Create: `backend/app/imports/excel.py`
- Create: `backend/app/imports/schema.py`
- Create: `backend/tests/imports/test_delimited.py`
- Create: `backend/tests/imports/test_excel.py`
- Create: `backend/tests/imports/test_schema.py`
- Create: `backend/tests/fixtures/` test workbooks and CSV files

**Interfaces:**
- Produces: `parse_delimited(stream, options) -> TabularPreview`.
- Produces: `list_workbook_sheets(stream) -> list[SheetInfo]` and `parse_workbook(stream, sheet_name) -> TabularPreview`.
- Produces: `apply_schema(preview, overrides) -> pyarrow.Table`.
- `TabularPreview` includes headers, sample rows, total row count when known, inferred fields, warnings, and workbook sheet metadata.

- [ ] **Step 1: Write failing parser tests** for quoted separators/newlines, UTF-8 CSV, TSV paste, null versus empty string versus zero, duplicate/blank headers, empty input, XLS/XLSX sheets, date/boolean cells, and formulas without cached values.
- [ ] **Step 2: Run `uv run pytest tests/imports -q`**; verify failures identify missing parser behavior.
- [ ] **Step 3: Implement parsers with standard-library CSV, python-calamine, and PyArrow**; parsing has no database or HTTP dependencies.
- [ ] **Step 4: Run parser tests**; expect all pass with no warnings.
- [ ] **Step 5: Commit** with `feat: parse pasted and spreadsheet data`.

### Task 4: Import API and Parquet snapshots

**Files:**
- Create: `backend/app/storage.py`
- Create: `backend/app/services/imports.py`
- Create: `backend/app/api/imports.py`
- Create: `backend/app/schemas/imports.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/api/test_imports.py`

**Interfaces:**
- Produces: `POST /api/imports/paste`, `POST /api/imports/files`, `GET /api/imports/{id}`, `POST /api/imports/{id}/confirm`.
- Produces: `LocalSnapshotStore.write_candidate(import_id, table) -> CandidateSnapshot`, `publish(candidate) -> storage_uri`, and `discard(candidate)`.
- Consumes: Task 2 publication repository and Task 3 parsers.

- [ ] **Step 1: Write failing API tests** for paste preview/confirm, CSV upload, XLS/XLSX sheet selection, file/content validation, repeated confirm idempotency, failed conversion cleanup, and atomic current-Snapshot publication.
- [ ] **Step 2: Run the import API tests**; verify expected missing-route/service failures.
- [ ] **Step 3: Implement upload streaming, generated paths, candidate Parquet writing, validation, and atomic publication**; never use client filenames as paths.
- [ ] **Step 4: Run import API tests and inspect temporary storage after failure cases**; expect tests pass and no published partial files.
- [ ] **Step 5: Commit** with `feat: publish immutable parquet imports`.

### Task 5: Dataset view-query API

**Files:**
- Create: `backend/app/schemas/view_query.py`
- Create: `backend/app/services/view_query.py`
- Create: `backend/app/api/datasets.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/api/test_dataset_views.py`

**Interfaces:**
- Produces: `POST /api/datasets/{id}/view-query` accepting selected fields, structured filters, groupings, measures, sort, limit, cursor/page request, and optional bins.
- Produces: response fields `snapshot_id`, `data_as_of`, `is_sampled`, `scope`, `columns`, `rows`, and continuation metadata.
- Filter AST supports `eq`, `in`, `contains`, `between`, `is_null`, AND across filters, and OR within `in` values.

- [ ] **Step 1: Write failing integration tests** for pagination, projection, each filter type, combined filter semantics, SUM/AVG/COUNT/DISTINCT, sorting, Top N, histogram bins, invalid fields/operators, injection-shaped values, missing Snapshots, and enforced result limits.
- [ ] **Step 2: Run dataset-view tests**; verify missing service/route failures.
- [ ] **Step 3: Implement a whitelist compiler from the request model to parameterized DuckDB queries** and query only the current or explicitly requested successful Snapshot.
- [ ] **Step 4: Run dataset-view tests**; expect all pass and no raw browser SQL accepted.
- [ ] **Step 5: Commit** with `feat: query dataset views safely`.

### Task 6: ChartConfig registry and adapters

**Files:**
- Create: `shared/chart-config.schema.json`
- Create: `frontend/src/charts/types.ts`
- Create: `frontend/src/charts/registry.ts`
- Create: `frontend/src/charts/toEChartsOption.ts`
- Create: `frontend/src/charts/toViewQuery.ts`
- Create: `frontend/src/charts/formatters.ts`
- Create: `frontend/src/charts/registry.test.ts`
- Create: `frontend/src/charts/toEChartsOption.test.ts`
- Create: `frontend/src/charts/toViewQuery.test.ts`

**Interfaces:**
- Produces: `ChartConfigV1`, `validateChartConfig(config, schema)`, `toViewQuery(config, filters)`, and `toEChartsOption(config, viewResult)`.
- Registry entries declare chart ID, label, required/optional field roles, defaults, editor sections, view-query builder, and option adapter.
- Includes KPI, table, bar, line, area, mixed, pie/doughnut, scatter/bubble, radar, funnel, gauge, waterfall, heatmap, histogram, box plot, tree, treemap, sunburst, Sankey, and map.

- [ ] **Step 1: Write failing table-driven tests** proving every catalog entry validates a legal binding, rejects a representative illegal binding, and produces a minimal option/view query; add exact tests for compatible type switching and `0.1234 -> 12.34%` display without source mutation.
- [ ] **Step 2: Run the three chart test files**; verify failures because the registry and adapters are absent.
- [ ] **Step 3: Implement the smallest declarative registry and shared adapters**; do not add a raw JSON editor or chart-specific components unless the option shape requires one.
- [ ] **Step 4: Run chart tests and JSON Schema validation fixtures**; expect all pass.
- [ ] **Step 5: Commit** with `feat: add versioned chart configuration`.

### Task 7: Resource APIs for charts, filters, and dashboards

**Files:**
- Create: `backend/app/schemas/resources.py`
- Create: `backend/app/api/charts.py`
- Create: `backend/app/api/filters.py`
- Create: `backend/app/api/dashboards.py`
- Create: `backend/app/repositories/resources.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/api/test_resources.py`

**Interfaces:**
- Produces CRUD endpoints for Charts, Filters, and Dashboards plus `POST /api/charts/preview`.
- Chart preview validates `ChartConfigV1`, executes Task 5 view queries, and returns data plus render-ready configuration inputs.
- Update requests require the current resource version.

- [ ] **Step 1: Write failing API tests** for create/read/update, stale-version conflicts, invalid Dataset field bindings, filter chart scope, shared Dataset references, Dashboard reopen, and deletion without cascading into referenced resources.
- [ ] **Step 2: Run resource API tests**; verify missing-route/repository failures.
- [ ] **Step 3: Implement minimal schemas, repositories, and routes** using Task 2 relationships and Task 5 query behavior.
- [ ] **Step 4: Run resource tests**; expect all pass.
- [ ] **Step 5: Commit** with `feat: persist charts filters and dashboards`.

### Task 8: Import and Dataset user interface

**Files:**
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/import/ImportDialog.tsx`
- Create: `frontend/src/import/SchemaPreview.tsx`
- Create: `frontend/src/datasets/FieldList.tsx`
- Create: `frontend/src/datasets/DataPreview.tsx`
- Create: `frontend/src/import/ImportDialog.test.tsx`
- Create: `frontend/src/datasets/DataPreview.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: Tasks 4 and 5 APIs.
- Produces: paste/upload flow, sheet selection, schema correction, progress/error state, Dataset field list, and server-paginated preview.

- [ ] **Step 1: Write failing component tests** for paste, file selection, multi-sheet choice, schema override, parsing errors, confirm state, null/empty/zero rendering, and page navigation.
- [ ] **Step 2: Run targeted frontend tests**; verify components are missing.
- [ ] **Step 3: Implement the import dialog and Dataset panels** with accessible labels, keyboard operation, focus management, and visible loading/error states.
- [ ] **Step 4: Run targeted tests and frontend typecheck**; expect all pass.
- [ ] **Step 5: Commit** with `feat: add dataset import workflow`.

### Task 9: Dashboard canvas, chart editor, and filters

**Files:**
- Create: `frontend/src/dashboard/DashboardPage.tsx`
- Create: `frontend/src/dashboard/DashboardCanvas.tsx`
- Create: `frontend/src/dashboard/ComponentPalette.tsx`
- Create: `frontend/src/dashboard/PropertyPanel.tsx`
- Create: `frontend/src/dashboard/ChartTile.tsx`
- Create: `frontend/src/dashboard/FilterTile.tsx`
- Create: `frontend/src/dashboard/useDashboardHistory.ts`
- Create: `frontend/src/dashboard/DashboardPage.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: Tasks 5-8 APIs and chart registry.
- Produces: three-column workspace, responsive drag/resize canvas, component create/duplicate/delete, structured property editing, scoped filters, preview, save/reopen, and undo/redo.

- [ ] **Step 1: Write failing component tests** for adding every registry chart from one data-driven catalog, valid/invalid bindings, type switching, filter AND/OR and scope semantics, layout operations, undo/redo, save conflict, stale data state, and reopen fidelity.
- [ ] **Step 2: Run dashboard tests**; verify expected component failures.
- [ ] **Step 3: Implement the three-column workspace using the registry and react-grid-layout**; ECharts rendering stays in one reusable tile, and property controls are generated from registry metadata where possible.
- [ ] **Step 4: Run dashboard tests, typecheck, and production build**; expect all pass.
- [ ] **Step 5: Commit** with `feat: build visual dashboard workspace`.

### Task 10: End-to-end workflow and deployment verification

**Files:**
- Create: `frontend/playwright.config.ts`
- Create: `frontend/e2e/import-dashboard.spec.ts`
- Create: `backend/tests/smoke/test_restart_persistence.py`
- Create: `README.md`
- Modify: `compose.yaml`
- Modify: `.env.example`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: one documented startup path and executable acceptance checks.

- [ ] **Step 1: Write failing Playwright and restart tests** covering paste percentage formatting, CSV import, XLS/XLSX sheet selection, representative charts from every adapter family, all filter types, save/reopen, failed import preservation, and Docker volume persistence.
- [ ] **Step 2: Run the new tests before final wiring**; verify they fail at the first missing workflow/deployment behavior.
- [ ] **Step 3: Add only the deployment wiring, fixtures, and user documentation required to pass**; document supported formats, limits, persistence, backup location, and V1 exclusions.
- [ ] **Step 4: Run `docker compose up -d --build`, backend full pytest, frontend unit tests/typecheck/build, Playwright, restart persistence test, and `docker compose down`**; record exact pass counts and any environmental exclusions.
- [ ] **Step 5: Re-read the design and acceptance list, verify each item against a test or manual browser check, then commit** with `test: verify v1 visualization workflow`.

