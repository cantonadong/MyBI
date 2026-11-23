# Data Workbench V1 Design

**Date:** 2026-10-23  
**Status:** Approved design  
**Source requirements:** `doc/Data_Workbench_PRD_v1.0.md` and `doc/Data_Workbench_PRD_v1.0.docx`

## 1. Purpose and scope

V1 delivers a complete file-to-dashboard workflow for users who already have tabular query results. A user can paste data or import CSV, XLS, or XLSX files, confirm the inferred schema, build configurable ECharts visualizations and filters on a canvas, save the dashboard, and reopen it later with the same data and presentation.

V1 explicitly excludes database connections, a SQL editor, online SQL execution, scheduling, pipelines, notifications, Trino, and multi-user authorization. The resource model preserves the boundaries needed to add SQL as another Dataset producer later without changing charts, filters, or dashboards.

## 2. Architectural approach

Use a lightweight full-stack deployment with production-compatible metadata from the start:

- React, TypeScript, and Vite for the web workspace.
- Apache ECharts as the chart rendering engine.
- FastAPI for resource, import, query, and dashboard APIs.
- PostgreSQL for mutable metadata and resource relationships.
- DuckDB for file conversion, server-side filtering, aggregation, sorting, and pagination.
- Immutable Parquet files for Dataset Snapshots.
- Docker Compose for the local Windows and future intranet deployment model.

V1 stores Parquet files in a mounted local volume and records stable storage URIs rather than UI names or user-supplied paths. Object storage can be added later without changing Dataset or Snapshot identities. Redis, Celery, MinIO, Trino, and a distributed scheduler are deferred until their workloads exist.

## 3. Stable resource model

The following boundaries are stable across V1 and the future SQL phase:

- **Dataset:** a named, reusable logical data source with a pointer to its current successful Snapshot.
- **Snapshot:** an immutable data version containing storage URI, schema, row count, byte size, status, creation time, and source metadata.
- **ImportRun:** one paste or file-import attempt and its status, progress, validation result, and error summary.
- **Chart:** a Dataset reference plus a versioned ChartConfig. It never owns or mutates source data.
- **Filter:** a typed filter definition bound to a Dataset field and scoped to selected charts.
- **Dashboard:** layout and references to Charts and Filters. It does not contain Dataset rows.

The V1 production flow is:

```text
Paste or upload
  -> ImportRun
  -> parse, infer, confirm, validate
  -> immutable Parquet Snapshot
  -> atomic Dataset current-snapshot update
  -> server-side view query
  -> ChartConfig and FilterConfig
  -> Dashboard layout
```

The future SQL flow becomes `Query -> QueryRun -> Snapshot -> Dataset`; downstream resources remain unchanged.

All resources use generated stable IDs. Chart, Filter, and Dashboard updates use a version or `updated_at` precondition to prevent lost updates.

## 4. User experience

The primary workspace has three columns and a top action bar:

- The left panel contains Dataset fields, chart components, and filter components.
- The center is a responsive Dashboard canvas with drag, move, resize, duplicate, and delete operations.
- The right panel edits the selected component.
- The top bar provides import, preview, save, undo/redo, Dashboard naming, and save/error status.

The system preserves saved Dataset selection, field mappings, chart configuration, filter scope, and canvas layout across navigation and browser restarts. Unsaved edits and in-progress imports are visible and cannot be mistaken for saved state.

## 5. Import behavior

### 5.1 Paste

Accept tabular text copied from Excel, Google Sheets, or text tools. Detect TSV or CSV structure, then show headers, sample rows, dimensions, inferred types, and parse warnings before saving.

### 5.2 CSV

Parse CSV on the server. UTF-8 is the default; encoding, delimiter, quote handling, and bad-row behavior are explicit import options when detection is insufficient. Large inputs are streamed and converted incrementally rather than read into browser memory.

### 5.3 XLS and XLSX

Parse workbooks on the server and allow the user to choose a worksheet. Read cell values only: never execute macros, external links, or formula code. Use cached formula results when available; report cells whose formulas have no cached result instead of silently inventing values.

### 5.4 Schema confirmation and publication

Infer string, numeric, boolean, date, and datetime types. Users may correct column names and types before publication. Null, empty string, numeric zero, date, and datetime remain distinct.

An ImportRun moves through `PENDING -> PROCESSING -> SUCCEEDED|FAILED`. It writes a candidate Parquet file, validates schema and counts, then atomically creates or advances the Dataset Snapshot pointer. A failed import never creates a successful Dataset or replaces a prior successful Snapshot. A repeated filename never silently overwrites prior data; V1 defaults to a new Dataset.

## 6. Visualization catalog and configuration

V1 supports these user-selectable components:

- KPI card and data table.
- Column/bar, line, area, and mixed Cartesian charts.
- Pie/doughnut, scatter/bubble, radar, funnel, gauge, and waterfall charts.
- Heatmap, histogram, and box plot.
- Tree, treemap, sunburst, and Sankey diagrams.
- Map when the selected geographic data and map asset are compatible.

A versioned ChartConfig is the product contract. Users edit structured controls rather than raw ECharts JSON. An adapter validates ChartConfig against the Dataset schema and produces ECharts options.

Common configuration covers title, size, theme, palette, legend, tooltip, labels, animation, empty-value behavior, dimensions, measures, series, aggregation, sorting, Top N, calculated display fields, and number/date formatting. Type-specific panels expose axes, stacking, smoothing, radius, bins, map regions, Sankey nodes, and equivalent settings only where applicable.

Changing chart type retains compatible settings. Missing or incompatible bindings are reported without modifying the Dataset or the last saved Chart. Percentage formatting converts a stored value such as `0.1234` to the display text `12.34%` and never writes `12.34` back to the Snapshot.

## 7. Filters and server-side view queries

V1 provides date range, single-select, multi-select, text search, and numeric range filters. Every filter binds to a Dataset field and names the charts it affects.

Different filters combine with AND. Values within one multi-select filter combine with OR. Filter values are represented by a validated structured expression, never by arbitrary SQL supplied by the browser.

DuckDB performs filtering, aggregation, sorting, Top N, bins, and pagination on the server. Responses contain only the rows or aggregate series needed by the component, plus Snapshot ID, data timestamp, sampling status, and result scope. The browser does not load an entire large Dataset.

Chart-click cross-filtering is deferred. The filter model leaves room for another input source later, but V1 avoids ambiguous interaction between chart selections and explicit filter controls.

## 8. Persistence and deletion semantics

Dashboards persist names, canvas layout, and Chart/Filter references. Charts persist Dataset references and ChartConfig. Datasets persist Snapshot history and the current successful Snapshot pointer.

Deleting a Dashboard removes its references only. It does not delete a Chart or Dataset still referenced elsewhere. Snapshot cleanup is not part of the V1 UI; destructive cleanup must later honor references and retention policy.

## 9. Security and operational limits

- Validate upload extension, MIME type, configured size limit, and actual file structure.
- Never use an uploaded filename as a storage path.
- Accept only generated resource IDs and scoped storage URIs at API boundaries; do not accept arbitrary server paths.
- Treat Datasets and Snapshots as read-only after publication.
- Configure upload size, result row count, query timeout, and concurrency limits through environment settings.
- Return safe user-facing parse errors while retaining enough structured context for diagnosis.
- Keep service and metadata database state in persistent Docker volumes.

## 10. Failure behavior

- Parsing, conversion, validation, or storage failure marks the ImportRun failed and leaves the current Snapshot unchanged.
- A Dashboard with unavailable data shows the reason, last successful data time, and stale state instead of a blank or misleading chart.
- Invalid ChartConfig or FilterConfig returns field-level errors and preserves the last saved configuration.
- A save conflict reports that the resource changed and does not overwrite the newer version.
- Restart recovery must not expose partial Snapshot files as successful versions.

## 11. API boundaries

Exact paths may be normalized in the implementation plan, but V1 needs these capabilities:

- Create paste/file imports, inspect workbook sheets, preview inferred schema, confirm an import, and read ImportRun status.
- List, inspect, and preview Datasets and Snapshots.
- Execute a validated Dataset view query for table rows or chart aggregates.
- Create, update, validate, preview, and read Charts.
- Create, update, and read Filters.
- Create, update, read, list, and delete Dashboards.

The view-query response includes `snapshot_id`, `data_as_of`, `is_sampled`, and result scope. Mutating responses include the current resource version.

## 12. Testing and acceptance

Unit and integration tests cover parsing, type inference and overrides, immutable publication, view-query expressions, aggregation, formatting, ChartConfig validation/adaptation, version conflicts, and reference-aware deletion. Browser tests cover the primary import-to-dashboard workflow. Docker startup and persistent-volume restart receive a runnable smoke check.

V1 is accepted when:

1. Pasted data containing null, empty string, zero, dates, and `0.1234` survives save/reopen with unchanged values and types; percentage display shows `12.34%`.
2. CSV, XLS, and XLSX each import successfully; a multi-sheet workbook requires an explicit sheet choice.
3. Every supported chart type can be created with valid bindings, saved, and reopened.
4. Invalid chart bindings report useful errors without changing source data or the last saved chart.
5. Date, enum, text, and numeric filters work individually and in combination, respecting chart scope.
6. Multiple Charts and Dashboards can safely reference one Dataset.
7. Failed imports and service restarts do not create or publish partial Snapshots.
8. Table pagination and chart aggregation occur server-side; the browser does not receive a full large Dataset.
9. A clean Docker Compose deployment starts successfully, and saved resources survive restart.
10. The API, import conversion, filter/aggregation path, and ChartConfig adapter have automated checks, and the main user journey has an end-to-end browser test.

## 13. Deferred work

The following are intentionally outside V1: database credentials and metadata browsing, SQL authoring/execution/history, scheduled refresh, job DAGs, notifications, Trino federation, object storage, distributed workers, chart-click cross-filtering, shared editing, SSO, and role-based access control.

Deferring them does not defer the stable Dataset/Snapshot/ChartConfig contracts they will consume.
