# MyBI v1.0

A local visual report builder for Windows, with Simplified Chinese and English UI.

## Windows release

Two packages are available for Windows 10/11 x64. Both include the Rust + Slint service manager and built web UI. Use a current Edge or Chrome browser. Running MyBI does not require PowerShell or .NET Framework.

| Package | Runtime dependencies |
| --- | --- |
| `MyBI-v1.0-Windows-x64-Portable.zip` | Includes Python and backend dependencies. Extract the entire folder and double-click `MyBI.exe` or `run.bat`. No Python or Node.js installation needed. |
| `MyBI-v1.0-Windows-x64.zip` | No Python environment included. Install Python 3.13 x64, then run the commands below in the extracted folder. Internet access is needed for the initial dependency download. |

```powershell
py -3.13 -m venv .venv
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install ./backend
```

Then double-click `MyBI.exe` or `run.bat`. Backend dependencies and minimum versions are declared in `backend/pyproject.toml`: FastAPI, Uvicorn, DuckDB, PyArrow, python-calamine, python-multipart, SQLAlchemy, Alembic, and psycopg. pip installs their transitive dependencies automatically. Node.js is only needed when building the frontend from source, not for either release package.

A normal desktop window with a MyBI taskbar icon shows the local service status. The service starts automatically; use the buttons to start or stop it, or open http://127.0.0.1:8000 in your browser. Minimize the window to keep it on the taskbar. Closing the window leaves the service running; reopen MyBI to manage it. Opening MyBI again restores and activates its existing manager window rather than displaying a duplicate-instance dialog. An existing healthy service from the same application folder is reused.

The manager uses the shared Chinese/English dictionary. Its initial language follows Windows; opening MyBI in a browser synchronizes the browser's resolved language, including changes made in Settings. No system service or automatic startup entry is installed.

Reports and profile settings are stored in `data-workbench.db`; imported data snapshots are in `data/snapshots`. Back up both together. Logs are in `data/logs`. Release packages contain no personal reports, profiles, or imported data.

## Features

- Paste tables or import CSV, XLS and XLSX files; configure field types, display names, dates, percentages and numeric precision.
- Build charts, tables and canvas filters with drag-and-resize layout, labels, series grouping and dual axes.
- Save, copy and publish reports; published reports are served by the same local service.
- Browse datasets referenced by saved reports, manage comments, and highlight weekends.
- Change language, chart palette and display defaults in Settings.

Published report links require this service to remain running. This is a local application, with no multi-user access-control system.

## Build from source

Use Windows x64, Python 3.13, Node.js, Rust's `stable-x86_64-pc-windows-msvc` toolchain, and Visual Studio C++ Build Tools with the Windows 10 SDK. Create `.venv`, install the backend with `.venv\Scripts\python.exe -m pip install ./backend`, and run `npm.cmd --prefix frontend ci`.

Run `./scripts/build.ps1` from a PowerShell development terminal to build the frontend and Rust manager. This script is a developer build tool, not a runtime dependency. Alternatively, build with `npm.cmd --prefix frontend run build`, then `cargo +stable-x86_64-pc-windows-msvc build --manifest-path desktop/Cargo.toml --release --locked` and copy `desktop/target/release/MyBI.exe` to the project root. Add `-Package` to the build script to create both Windows ZIPs and `SHA256SUMS.txt` under `artifacts`. Packaging reuses an existing bundled `runtime` when present; otherwise it collects Python and backend dependencies from the local environment for the portable variant only.

The manager starts Python directly and keeps stdout/stderr in `data/logs`, without a shell. It verifies the project path and Python process before stopping a service. `run.bat --check` checks the runtime and web build without starting the service. The optional developer script `scripts/build-selfsigned.ps1` builds the same Rust manager and signs a local copy; it does not add the certificate to a trust store. Rebuilding or self-signing does not establish publisher trust or guarantee acceptance by endpoint security.

After pulling updates on another computer, rerun `npm.cmd --prefix frontend ci` and `./scripts/build.ps1` to refresh both the web build and `MyBI.exe`. Commit `frontend/package-lock.json` and `desktop/Cargo.lock` with dependency changes. Generated executables, `frontend/dist`, runtimes, databases and imported snapshots are local files and are not synchronized by Git.

Tests are not run by the build script. v1.0 was built and packaged without running the test suite.
