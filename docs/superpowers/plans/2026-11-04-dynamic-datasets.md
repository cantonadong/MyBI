# Dynamic datasets implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. User has authorized development. Work on main, do not run tests or create preview executables.

**Goal:** Deliver server-owned dynamic datasets, managed files/caches, daily jobs and duration display.
**Architecture:** Extend existing SQLAlchemy/Parquet API with source/job metadata, atomic manifests and refresh leases; React consumes these APIs; Rust manager restarts the local service.
**Tech Stack:** Existing FastAPI, SQLAlchemy, psycopg, PyArrow, React and Slint; authenticated encryption for saved database passwords.
**Spec:** `docs/superpowers/specs/2026-11-04-dynamic-datasets-design.md`

## Global constraints
- Main only; no tests run; build the existing MyBI.exe for user validation.
- All changed UI copy localized; original data values and immutable published snapshots preserved.
- Data/cache filenames use IDs/dates; manifests and responses never expose passwords.

## Review focus
- Failed query/file write must keep previous successful snapshot and daily cache.
- Concurrent manual/scheduled refresh must not execute twice or overwrite changed source configuration.
- Cache deletion must not break snapshots referenced in saved/published reports.
- Old resource files must migrate without deleting old snapshots or altering report content.
- Server authentication and encrypted credentials must work without Windows-specific APIs.

### Task 1: Physical resource files
- [x] Add configurable roots and atomic manifests in backend/app/storage.py.
- [x] Integrate dataset publish/field edit and dashboard save/publish/delete; migrate existing metadata at startup.
- [x] Add reference-aware dataset deletion and cache file inventory.

### Task 2: Dynamic source execution
- [x] Add source/job table, encrypted credentials, input validation and read-only psycopg execution.
- [x] Implement validate/create/configure/refresh, daily cache publication and database lease coordination.
- [x] Preserve original column values and format overrides through existing publish().

### Task 3: Server job execution and deployment
- [x] Add persistent daily schedule/timezone calculation and worker loop with last/next state.
- [x] Add optional server Basic authentication, Compose worker/resources/secrets configuration and deployment instructions.

### Task 4: User interface
- [x] Rename connect-data entry points; add dynamic connection/query form with validation and preview.
- [x] Add dataset source editing, schedule settings, refresh, cache inventory/delete and query duration.
- [x] Use existing compact controls, toasts and shared localization.

### Task 5: Desktop and verification
- [x] Make the service action restart when running and start when stopped, including its context menu.
- [x] Build frontend and the existing root MyBI.exe, inspect changes and obtain independent code review.
- [x] Report runtime validation limits without running tests.

## Execution record
- Physical storage, read-only source queries, encrypted credentials, daily cache APIs, persistent schedules, React management and server Compose configuration implemented.
- Ruling: source support is PostgreSQL for the first release, matching the approved scope; MyQuery Rust widgets are reused as form/connection semantics through the existing Python driver.
- Ruling: dynamic published reports resolve the latest successful result when opened; static published reports remain pinned. Historical snapshots are retained.
- Independent read-only review completed; fixed SQLite timezone serialization and rollback-backup acquisition before optimistic write ownership.
- Added targeted regression cases without running them, per user instruction; updated their disposable storage roots so future runs cannot touch user files.
- Frontend build, backend compileall and git diff --check pass. No tests or database/server runtime validation have been run.
- Desktop release build completed with the installed GNU Rust toolchain and temporary LLVM MinGW tools; LIBRARY_PATH points to Rust's self-contained GCC libraries. MSVC is unavailable on this machine (Git's link.exe was selected instead). No compiler/dependency changes were needed in the repository.
- Replaced root MyBI.exe with the release artifact and verified matching SHA-256; its imports require only Windows system DLLs. Build scripts retain the documented MSVC development requirements. User runtime validation remains outstanding.
- User correction: run only in the Windows notification area, without a manager window or taskbar entry. Replaced the window event loop with a hidden native tray host; right-click offers restart, stop, open MyBI and exit tray while keeping the service running. Double-click opens MyBI. Repeated launch exits without restoring any window. Rebuilt frontend and GNU desktop release and overwrote root MyBI.exe (SHA-256 A46DF00B0DA2E12807CBC16ADDD29D56195C2B86B41B3EB4F08A094C85A04106). No tests or runtime validation run.
