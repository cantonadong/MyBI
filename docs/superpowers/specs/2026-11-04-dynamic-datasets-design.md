# Dynamic datasets and server operation

Approved scope: discard old local launcher work; restart service; physical dataset/report files; rename import to connect data; PostgreSQL SQL/table/view/materialized-view sources, validation, daily caches, forced refresh, schedules and query duration; server deployment. Cache layout was delegated to the implementer.

## Approach
Use the existing Python API, SQLAlchemy metadata and Parquet query engine. The desktop manager only starts/stops the service. Browser-owned or desktop-owned scheduling would stop when those clients close, so execution belongs to the server. Reuse MyQuery connection fields and TLS semantics with the existing psycopg driver, rather than embedding its Rust UI.

## Files and preservation
Default roots are `datasets/` and `reports/` beside MyBI.exe (project root in source deployments); server deployments override roots with environment variables. Dataset UUIDs name directories. `dataset.json` is a portable, non-secret manifest; `snapshots/<snapshot-id>.parquet` retains immutable snapshots referenced by published reports. `cache/YYYY-MM-DD.parquet` is the successful result for that dataset's configured timezone and date; forced refresh replaces only that date after successful publication. Report files are `<report-id>.json`, with published documents stored separately. Existing database records and old snapshot locations remain readable and are materialized on startup. File deletion follows resource deletion, and referenced datasets cannot be deleted. Failed refreshes retain the previous successful snapshot/cache.

## Dynamic sources
PostgreSQL connection form: host, port, database, user, password, TLS/certificate policy. Sources select SQL or schema-qualified table/view/materialized view. Validate using an actual read-only query with timeout and bounded result size; show schema, sample, row count, elapsed time and empty-result failure. Parameters quote identifiers; arbitrary SQL is wrapped as a single read-only result query. Secrets are encrypted on the backend, omitted from resource manifests, API responses, reports and logs; encryption key can be supplied externally for server deployments. Use a dedicated read-only database account.

## Refresh, schedules and UI
Daily cache is consulted before querying; force bypasses cache. Query duration means server query/result fetch duration, distinct from cache-read duration. Show largest applicable seconds/minutes/hours unit in validation, dataset details and last job status. Source configuration, cache list, delete cache, force refresh and daily schedule (time plus IANA timezone) live in dataset management. Persist last/next run and last error; use database leases to prevent duplicate overlapping execution, including multiple API workers. Browser closure does not stop jobs. Refresh failure never erases good data. All changed text uses shared Chinese/English localization; compact controls follow existing styles.

## Server deployment
Keep API/worker runtime independent of Windows. Mount a persistent resource volume for datasets/reports/keys. Docker Compose runs the existing PostgreSQL metadata database, API, independent scheduler and web proxy; require server credentials and a stable encryption key. Authentication protects server API access; local loopback retains the existing single-user workflow. Existing snapshots are preserved during migration. No changes to numeric precision or canvas-filter rules.

## Implementation decisions
Published dynamic reports resolve the latest successful dataset when opened; each opened page still pins a consistent snapshot. Static reports retain their published snapshots. No running page polls the source database. Cache rollback backups are taken after acquiring database write ownership, so a conflicting save cannot restore an older file over a successful save. SQLite job timestamps are serialized explicitly as UTC.

## Validation constraint
User forbids running tests. Compile frontend and desktop, inspect the changed call paths and build the existing root MyBI.exe; do not claim database or server runtime validation without a supplied database/server.
