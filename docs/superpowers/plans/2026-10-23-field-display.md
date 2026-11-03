# Field Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Native execution was previously selected.

**Goal:** Centralize persisted field display formats, preview 10 rows, adapt label density, and allow five-second deletion undo.

**Architecture:** Store display metadata alongside existing snapshot field definitions without rewriting Parquet or changing the database schema. Return field_formats separately, use one frontend formatter across consumers, and rebuild chart options after resize.

**Tech Stack:** Existing FastAPI, SQLAlchemy, PyArrow, React, TypeScript, ECharts; no new dependency.

**Spec:** ../specs/2026-10-23-field-display-design.md

## Global Constraints

- 数据集预览仅取前 10 行，保留全部列和横向滚动。
- 格式不改变原始值、聚合结果、筛选条件或数据快照内容。
- 展示格式作为数据集字段设置持久化，统一在列头修改。
- 删除 Toast 完整显示 5 秒。
- Preserve user data and unrelated edits; this directory has no Git repository, so no commits/worktree creation.

## Review Focus

- Fractional values occurring after preview row 10 must not cause integer misclassification.
- Nulls, numeric-looking text IDs, date and boolean fields must not become percentages or NaN.
- Updating one field must preserve other fields' settings; stale versions must fail visibly.
- Different metrics must use their respective formats in labels/tooltips rather than the primary metric's format.
- Resizing and rapid consecutive deletes must not leave stale label intervals or early-expiring undo timers.

## Task 1: Persist field display settings

**Files:** backend/app/api/datasets.py; backend/tests/api/test_visualization.py.

**Interface:** field_formats maps field names to {kind: integer|decimal|text, format: number|percent, decimals: 0..8}. PATCH /api/datasets/{id}/field-format accepts {field,format,decimals,version} and returns updated dataset metadata; unknown/non-numeric fields and invalid precision return 422, stale version returns 409.

- [x] Write failing tests for full-data inference with a decimal beyond row 10, format persistence, unchanged raw query values, independent fields, invalid inputs, and stale updates.
- [x] Run `.venv/Scripts/python.exe -m pytest backend/tests/api/test_visualization.py -q`; confirm new tests fail for missing behavior.
- [x] Add display defaults at publish time and legacy fallback from Arrow storage types; retain existing response schema name/type entries. Persist field changes with an atomic version check.
- [x] Run the complete backend suite; require all tests passing.

## Task 2: Central field formatting and ten-row editor

**Files:** frontend/src/DatasetPreview.tsx; frontend/src/dashboard.ts; frontend/src/App.tsx; frontend/src/charts/registry.ts; frontend/src/charts/ChartView.tsx; frontend/src/charts/options.ts; frontend/src/styles.css; focused frontend tests.

**Interface:** Dataset.field_formats holds the server map. Shared formatField(value, format) handles nulls/text/numbers, default decimal precision 1, and percent scaling. DatasetPreview emits the successful updated dataset via onChange; ChartTile passes current dataset formats to chart renderers, not stale dashboard copies.

- [x] Write failing formatter/editor tests for 0.1234 → 12.3%, integer display, NULL/text preservation, 10-row request, save failure and successful update.
- [x] Implement header type badges and numeric format/precision controls. Serialize field saves and surface conflicts; update cached dataset only after success.
- [x] Remove the independent right-panel format selector. Apply field formats to labels, relevant axes, tooltip values, KPI and table cells, without changing underlying series values or histogram frequencies.
- [x] Run the complete frontend suite and production build.

## Task 3: Density and five-second undo

**Files:** frontend/src/charts/options.ts; frontend/src/charts/ChartView.tsx; frontend/src/App.tsx; tests/browser_delete_undo.py; tests/browser_editor_polish.py; density/format tests.

- [x] Add failing checks: narrow charts show fewer labels than wider charts with the same data; all data remains available; resize recomputes; undo works at 4.9 seconds, expires at 5 seconds, rapid deletion resets the deadline.
- [x] Use measured text and available chart dimensions for uniform Cartesian label stride, plus native hideOverlap. Recompute options through the existing ResizeObserver.
- [x] Change the deletion deadline and Toast copy to 5 seconds; retain timer cleanup, session guards and targeted restore.
- [x] Update preview acceptance assertions to 10 rows; verify column formatting survives close/reopen and page reload and immediately affects an existing chart.
- [x] Run all frontend/backend tests, production build, browser workflows and BAT entry check; update README with field formatting, preview limit and undo timing.

## Execution

Native implementation in the current workspace after plan review. Test-first changes, then one focused review of persistence and formatting propagation. External application clipboard behavior is unchanged by this work.
