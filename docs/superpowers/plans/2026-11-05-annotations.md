# Annotation import implementation plan

**Goal:** Reuse static and dynamic imports for report annotations, with movable label headers and per-chart visibility.

**Architecture:** Reuse imported datasets and store the three annotation field roles in snapshot schema metadata, preserving them across refreshes and saved-dataset reuse. Read their snapshots through the existing view-query API, and render date intervals with the existing chart engine. Publishing retains annotation datasets and their snapshots.

**Constraints:** Work on main; preserve existing work; no tests run; no dependencies. Localize changed UI. Build and overwrite MyBI.exe.

- [x] Add the unchecked shared import option and draggable/keyboard-accessible role headers; validate all annotation rows before saving.
- [x] Persist annotation mappings, include referenced datasets in publishing and existing deletion checks, and load raw rows through existing queries.
- [x] Add conditional chart visibility and date-axis interval shading, layered labels and finite boundary lines.
- [x] Review NULL boundaries, reordered columns, dynamic refreshes, saved/published reports, and cancellation; build frontend and EXE without running tests.

Validation: frontend production build and Python syntax compilation succeeded. EXE built with the existing GNU toolchain and temporary LLVM tools; the default MSVC path resolves Git's unrelated link.exe. No tests or GUI verification run, per project preference. Annotation bands require a chronologically ordered date x-axis; compact cards cap visible label lanes to retain plot space.
