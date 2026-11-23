# Public report access implementation plan

Goal: configurable IP/domain links and an independent read-only listener for published reports.
Architecture: run a second Uvicorn server inside the existing backend lifecycle; reuse dataset queries behind report-scoped authorization. Management remains on loopback port 8000.
Spec: ../specs/2026-11-11-public-report-access-design.md

Constraints: main branch; preserve existing changes; no tests per user instruction; no new dependencies; shared Chinese/English localization. Execute inline under existing authorization.

- [x] Add backend/app/public_access.py: persisted validated settings, listener lifecycle/status, report-scoped read endpoints and static allowlist. Reject unpublished reports, unrelated datasets and snapshots, management routes and writes. Bind before saving so port conflicts do not overwrite working configuration.
- [x] Integrate lifecycle and management-only settings router into backend/app/main.py. Keep startup failures visible without stopping local editing.
- [x] Add frontend/src/PublicAccessSettings.tsx using existing settings styling and shared localization. Add copy-link action for published reports; route view API calls through report-scoped public endpoints and hide comments in public view.
- [x] Review allowed routes and source metadata exposure, build frontend and launcher, overwrite and restart D:/Dev/MyBI/MyBI.exe. Do not run tests; report domain and external-network verification limits.

Review focus: port collisions; disabled/restarted listener; static snapshot isolation versus dynamic refresh; no private metadata or management leakage; domain normalization including explicit external ports and HTTPS reverse proxies.

Verification: frontend build, full project build, Python syntax compilation and git diff --check passed. Existing LLVM v2.0.12 path supplied to build script. Restarted the original MyBI.exe. No tests or external IP/domain access checks performed.

Review rulings: dynamic metadata retains a safe disabled schedule for the existing renderer; public dynamic queries always use the server-resolved latest snapshot, while static queries retain the published snapshot; failed binding leaves the old listener running. Independent read-only review found no remaining important issues in those fixes. Mid-refresh dynamic pagination can reflect a newer dataset, consistent with viewing the latest successful data.
