# Rust service manager implementation plan

**Goal:** Replace the C# / PowerShell runtime launcher with an ordinary Rust + Slint desktop service manager.

**Architecture:** One native manager window directly starts/reuses the existing loopback Uvicorn service. Closing the window leaves the service alive. Existing browser reports and storage remain unchanged.

**Tech stack:** Rust, Slint (matching MyQuery), Windows APIs, existing Python/FastAPI and React.

**Spec:** ../specs/2026-11-04-rust-service-manager-design.md (approved by user).

## Constraints and rulings

- Work directly on main; do not run tests, per user instructions. Leave runnable regression checks and compile production code only.
- Implement inline; no unrelated features, no deployment, no commits requested.
- Existing browser localStorage cannot be read by native code. Mirror the resolved UI locale through a narrow validated backend endpoint to a small local preference file, then reuse en.json in Rust.
- Preserve the user's untracked build-selfsigned.ps1; retire old tracked runtime entry points.

## Tasks

- [x] Add minimal Rust manager project, embedded shared dictionary and icon, native window, single-instance guard, background service worker, health/path/PID validation, direct process launch and browser open. Include focused unit checks for health validation and locale fallback; do not execute them.
- [x] Mirror browser locale through the backend and add a small validation/persistence regression check. Use existing localization for every native label/error.
- [x] Replace build and batch entry points, remove obsolete tracked C# and runtime PowerShell scripts, update packaging and README, and repair stale launcher check references.
- [x] Compile the frontend and native launcher, inspect diffs and package contents, record evidence and any endpoint protection/build blockers. No tests or lifecycle checks are to be run.

## Review focus

- An unrelated occupant of port 8000 must not be stopped or treated as MyBI.
- PID reuse must not cause an unrelated process to be terminated; validate a process handle and recheck health before terminating.
- A startup failure must show an error and log location, including missing runtime/assets and backend exit/timeout.
- Two manager invocations must not create two services; a healthy existing service is reused.
- Closing the manager must leave Python running and must not strand stdout/stderr pipes.

## Progress

- Design approved. Existing entry points and callers inspected; main branch confirmed.
- Reused MyQuery dependency lock versions; Rust MSVC release build and frontend production build succeeded. npm dependencies restored from the existing lockfile.
- Reviewed by a fresh read-only reviewer. Fixed retained errors, overall HTTP body deadline, and the written lifecycle check's native-window discovery/race. Tests were not run.
- Root MyBI.exe SHA256: 5ce0c90b37de37db7bd7155cf25c59c8dea107863d29627ff6504cb5a13f6e9d. Native window observed and captured; root executable survived compilation/copy/start in this session.
- Restarted the local backend to apply the locale endpoint; final native manager PID 55044 directly started runtime/python.exe PID 53272, /api/health reported ok with this project root, and OpenAPI includes /api/profile/locale. No full feature-test claim is made.
- Packaging supports the existing bundled runtime without requiring pip; both release ZIPs generated. Python stdlib contains its optional venv PowerShell activation template, which MyBI does not invoke. The application launcher and package contain no PowerShell launch chain.
- User's untracked scripts/build-selfsigned.ps1 preserved. No security policies, trust stores or antivirus exclusions changed; no commit or push performed.
- Follow-up: duplicate launches now restore/activate the same-folder native window, with a bounded wait for first-window creation. Updated the written lifecycle check; not executed. Rebuilt/replaced the root EXE and refreshed both ZIPs. Current EXE SHA256: 229db1040b5f672c31fc0323c0d35b0d75d09838d9a219af82d6e3a08e7221a3. Manager PID 52568; existing backend PID 53272 preserved.
- Follow-up diagnosis: tool-launched GUI windows live on CodexSandboxDesktop, which is invisible from the user's normal desktop while holding the same session-local singleton mutex. Closed the sandbox manager, confirmed no remaining manager processes and retained the healthy backend. Do not leave a tool-launched manager running when asking the user to open MyBI. User requested no further ZIP generation.
- User subsequently requested a full source push to Git. Updated the previously local self-sign script to build Rust instead of the removed C# launcher, and documented rebuilding generated files after pulling on another computer. No signing or certificate creation was executed.
