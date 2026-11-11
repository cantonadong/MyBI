# MyBI v1.3

A local visual report builder for Windows, with Simplified Chinese and English UI.

## Windows release

Two packages are available for Windows 10/11 x64. Both include the Rust + Slint service manager and built web UI. Use a current Edge or Chrome browser. Running MyBI does not require PowerShell or .NET Framework.

| Package | Runtime dependencies |
| --- | --- |
| `MyBI-v1.3-Windows-x64-Portable.zip` | Includes Python and backend dependencies. Extract the entire folder and double-click `MyBI.exe`. No Python or Node.js installation needed. |
| `MyBI-v1.3-Windows-x64.zip` | No Python environment included. Install Python 3.13 x64, then run the commands below in the extracted folder. Internet access is needed for the initial dependency download. |

```powershell
py -3.13 -m venv .venv
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install ./backend
```

Then double-click `MyBI.exe`. Backend dependencies and minimum versions are declared in `backend/pyproject.toml`: FastAPI, Uvicorn, DuckDB, PyArrow, python-calamine, python-multipart, SQLAlchemy, Alembic, and psycopg. pip installs their transitive dependencies automatically. Node.js is only needed when building the frontend from source, not for either release package.

MyBI starts the local service automatically and stays in the Windows notification area. Use its tray menu to restart or stop the service, open http://127.0.0.1:8000, or exit. Opening MyBI again reuses the existing instance. An existing healthy service from the same application folder is reused.

The manager uses the shared Chinese/English dictionary. Its initial language follows Windows; opening MyBI in a browser synchronizes the browser's resolved language, including changes made in Settings. No system service or automatic startup entry is installed.

Reports and profile settings are stored in `data-workbench.db`; imported data snapshots are in `data/snapshots`. Back up both together. Logs are in `data/logs`. Release packages contain no personal reports, profiles, or imported data.

## Features

- Paste tables or import CSV, XLS and XLSX files; configure field types, display names, dates, percentages and numeric precision.
- Build charts, candlesticks, tables and canvas filters with automatic layout adjustment, labels, series grouping and dual axes. Configure independent metric aggregations, automatic titles and legends, and optional canvas guides.
- Use date ranges or rolling Last X day/week/month/quarter/year filters; discard fields during import or dataset editing. Configure Annotation roles and column order in field settings.
- Save, copy and publish reports; published reports are served by the same local service.
- Browse datasets referenced by saved reports, manage comments, and highlight weekends.
- Change language, chart palette and display defaults in Settings.

Published report links require the service to remain running. Local mode is single-user. Server mode supports a shared administrator login; it does not provide separate user roles.

**Public report access** in Settings starts a separate read-only listener on a configurable port (default 8001). It detects the public IPv4 address using HTTPS requests to ipify; an optional domain overrides the generated link address. Publish a report, then use **Copy link** in the reports list. Only published reports and their associated data are exposed; editing, connection settings and comments remain local. Firewall access and router port forwarding may be required. Detecting an outbound public IP does not bypass CGNAT or configure DNS, HTTPS certificates or port forwarding.

Reports support multiple named tabs. Switching from a data source to field configuration reads a fresh preview and reports added/removed fields. Numeric-only inputs default their first field to a text dimension. Percentage names are recognized without case sensitivity. Chart labels support automatic units and positions; candlestick values use their individual coordinates. **Show first X** also limits the category axis for category charts.

## Connected datasets and files

Use **Connect data** in the report editor or Dataset management. File/clipboard sources keep the existing field configuration workflow. Dynamic sources connect to PostgreSQL using host, port, database, username, password and TLS settings, and read SQL results, tables, views or materialized views. Use a dedicated read-only database account. TLS verifies the server certificate and hostname by default; enable Trust server certificate only for a server whose certificate you have independently verified.

**Validate query** runs the query and checks the connection, SQL/object, unique columns and non-empty result. It shows sample rows, row count and server query/result-fetch duration in the largest applicable unit. Saving a new source queries again to persist a fresh complete result. Validation results are previews, not saved datasets.

Dataset management lets you edit sources, read today's cache, force refresh and manage cache files. Set a daily query time and IANA timezone once in the report's overall properties to refresh its connected dynamic datasets. Save the report to apply its schedule. Shared datasets already refreshed after a scheduled time are not queried again for that occurrence. Failed runs retain the previous successful snapshot and expose the last error. Scheduling requires the service to remain running, but not the browser.

Files are managed beside `MyBI.exe` by default:

```text
datasets/<dataset-id>/dataset.json
datasets/<dataset-id>/snapshots/<snapshot-id>.parquet
datasets/<dataset-id>/cache/YYYY-MM-DD.parquet
datasets/<dataset-id>/cache/YYYY-MM-DD.json
reports/<report-id>.json
```

The date uses the dataset schedule's timezone. Force refresh replaces that date's cache; immutable snapshots remain available to published reports. Deleting a cache does not delete report snapshots. Deleting a dataset removes its managed directory and is blocked while a saved or published report references it. Existing snapshots are copied into managed directories at startup without deleting their old files. Report JSON includes its published version. The metadata database remains authoritative; these files are maintained by the service, so do not rename or edit them while it is running.

Connection passwords are encrypted in the metadata database and excluded from manifests, report files and API responses. Local mode creates `data/secret.key`. Back up the metadata database, `datasets/`, `reports/` and the key together. Losing the key requires entering database passwords again. File backups alone do not restore the metadata database.

## Server deployment

When a published report is opened, dynamic datasets resolve their most recent successful snapshot. Static datasets keep their published snapshots. An open report checks dynamic dataset metadata every 15 seconds and reloads chart data and automatic date bounds after a successful refresh; it does not repeatedly run source database queries.

The existing Docker Compose stack runs PostgreSQL metadata storage, the API, a separate scheduler and the web proxy. Queries and schedules execute on the server, not in a user's browser. Set these environment variables in an untracked `.env` before `docker compose up -d --build`:

```dotenv
MYBI_DB_PASSWORD=replace-with-a-long-url-safe-database-password
MYBI_ADMIN_USER=admin
MYBI_ADMIN_PASSWORD=replace-with-a-long-unique-login-password
MYBI_SECRET_KEY=replace-with-a-fernet-key
```

Generate a key with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` after installing backend dependencies. Keep this key stable across API/worker restarts and replicas. A metadata database password embedded in a URL must be URL-safe (or URL-encoded); existing installations must use their current PostgreSQL password. API access requires the configured Basic login. The default published ports bind to loopback; place the web proxy behind an HTTPS reverse proxy or an authenticated private-network gateway before exposing it to other machines. This shared login is not multi-user authorization.

Persistent volumes: `postgres-data` stores metadata, `resource-data` stores managed dataset/report files, and the original `snapshot-data` volume retains legacy snapshots. Back up all three volumes and `.env` together. Do not use `docker compose down -v` when retaining data. `DATASET_ROOT` and `REPORT_ROOT` allow non-container server installations to choose persistent directories. `MYBI_SCHEDULER=false` disables the API's embedded scheduler when running `python -m app.scheduler` separately. Database leases prevent overlapping refreshes of the same dataset across workers. Start a single API process for initial schema creation before adding workers.

Dynamic queries default to 300 seconds, 1,000,000 rows and the existing 100 MiB dataset input size limit. Configure `DYNAMIC_TIMEOUT_SECONDS`, `DYNAMIC_MAX_ROWS` and `MAX_UPLOAD_BYTES` identically for API and scheduler. Do not grant untrusted users access to connection configuration: connected-source administrators can reach database hosts accessible to the server.

## Build from source

Use Windows x64, Python 3.13, Node.js, Rust's `stable-x86_64-pc-windows-gnu` toolchain and LLVM-MinGW. Create `.venv`, install the backend with `.venv\Scripts\python.exe -m pip install ./backend`, and run `npm.cmd --prefix frontend ci`.

Run `./scripts/build.ps1 -LlvmBin <LLVM-MinGW-bin>` from a PowerShell development terminal to build the frontend, shared MyQuery core and Rust manager. This script is a developer build tool, not a runtime dependency. The current script uses `stable-x86_64-pc-windows-gnu`; the sibling `../MyQuery` workspace must provide its shared-core build, or a prebuilt `myquery_core.dll` must be available with an appropriate `-MyQueryRoot`. Release packages include this DLL. Add `-Package` to create both Windows ZIPs and `SHA256SUMS.txt` under `artifacts`. Packaging reuses an existing bundled `runtime` when present; otherwise it collects Python and backend dependencies from the local environment for the portable variant only.

The manager starts Python directly and keeps stdout/stderr in `data/logs`, without a shell. It verifies the project path and Python process before stopping a service. The optional developer script `scripts/build-selfsigned.ps1` builds the same Rust manager and signs a local copy; it does not add the certificate to a trust store. Rebuilding or self-signing does not establish publisher trust or guarantee acceptance by endpoint security.

After pulling updates on another computer, rerun `npm.cmd --prefix frontend ci` and `./scripts/build.ps1` to refresh both the web build and `MyBI.exe`. Commit `frontend/package-lock.json` and `desktop/Cargo.lock` with dependency changes. Generated executables, `frontend/dist`, runtimes, databases and imported snapshots are local files and are not synchronized by Git.

Tests are not run by the build script. v1.3 was built and packaged without running the test suite.
