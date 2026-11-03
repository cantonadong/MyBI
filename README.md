# MyBI v1.0

A local visual report builder for Windows, with Simplified Chinese and English UI.

## Windows release

Two packages are available for Windows 10/11 x64. Both include the tray launcher and built web UI. Use a current Edge or Chrome browser; the launcher uses Windows PowerShell 5.1 and .NET Framework 4.x, included with Windows 10/11.

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

A tray icon shows whether the local service is running. Double-click it to open http://127.0.0.1:8000. Its menu can start or stop the service, or exit MyBI. Windows may put the icon in the tray overflow area.

Reports and profile settings are stored in `data-workbench.db`; imported data snapshots are in `data/snapshots`. Back up both together. Logs are in `data/logs`. Release packages contain no personal reports, profiles, or imported data.

## Features

- Paste tables or import CSV, XLS and XLSX files; configure field types, display names, dates, percentages and numeric precision.
- Build charts, tables and canvas filters with drag-and-resize layout, labels, series grouping and dual axes.
- Save, copy and publish reports; published reports are served by the same local service.
- Browse datasets referenced by saved reports, manage comments, and highlight weekends.
- Change language, chart palette and display defaults in Settings.

Published report links require this service to remain running. This is a local application, with no multi-user access-control system.

## Build from source

Use Windows x64, Python 3.13 and Node.js. Create `.venv`, install the backend with `.venv\Scripts\python.exe -m pip install ./backend`, and run `npm.cmd --prefix frontend ci`.

Run `powershell -ExecutionPolicy Bypass -File scripts/build.ps1` to build the frontend and tray launcher. Add `-Package` to create both Windows ZIPs and `SHA256SUMS.txt` under `artifacts`. Packaging uses the Python runtime and installed backend dependencies from the local environment for the portable variant only.

Tests are not run by the build script. v1.0 was built and packaged without running the test suite.
