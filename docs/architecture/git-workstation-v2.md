# Git-backed workstation v2: maintenance and portable evidence

This iteration completes toolkit upgrade/recovery, read-only legacy document import, and Git report reindexing on top of v1. It retains the separate workstation/Spec/product ownership model. It does not automatically write to `bdd-spec` or move the legacy UI/Agent/MCP workflows onto the new model.

## Start and verify

```sh
npm run start:repositories        # 127.0.0.1:4180/repositories
npm run check:workstation
npm run test:workstation         # actual temporary Git, SQLite, CLI, processes, HTTP
npm run test:workstation:e2e     # real pinned dependencies and sandboxed Chromium required
```

The normal workstation also mounts `/repositories`. Deploy the complete repository, not only `dist/`. Node 24 is the production runtime. `.github/workflows/workstation.yml` now validates Node 24, performs browser acceptance of the new repository workflow, and separately builds/tests the existing application. A failed or unavailable prerequisite is not converted to a skip or product pass. Reports-only pushes are excluded from CI to prevent report-commit loops.

## Toolkit upgrades

New Spec repositories receive toolkit version `1.1.0`. Existing repositories never update automatically. On the maintenance tab, preview the upgrade, review the changed file hashes, then apply to a clean Spec checkout. CLI equivalents:

```text
scripts/spec/upgrade-preview.mjs  -> workspace.upgrade.preview
scripts/spec/upgrade.mjs          -> workspace.upgrade.apply
scripts/spec/resume.mjs           -> workspace.transaction.resume
```

The apply request supplies `input.planDigest` and the usual inspected `expected.head`. Only managed `.workbench-tools/` files change. Gherkin, SD, steps, hooks, BDD configuration and dependency locks are preserved. Customized or undeclared toolkit files block the upgrade instead of being overwritten. A successful upgrade modifies the working tree only; review and commit it explicitly. Changes to the toolkit invalidate the dependent test confirmation.

Before a file is changed, a durable transaction saves its expected old hash and new bytes under `WB_HOME/transactions/<workspace>/<operation-id>.json`. An interrupted transaction can resume by ID. Every file must still match its original or intended hash, and the checkout must have the same HEAD. A human edit made after interruption blocks recovery. Completing or resuming a transaction never commits or pushes implicitly.

The transaction is a recoverable sequence of atomic file replacements, not an atomic multi-file filesystem transaction. Journals include migrated source content; protect and back up `WB_HOME` as private operational data.

## Legacy SQLite import

The integrated application uses its configured old metadata database and artifact directory. For the standalone workstation explicitly set:

```sh
WB_LEGACY_DB=/absolute/path/metadata.sqlite \
WB_LEGACY_ARTIFACTS=/absolute/path/artifacts \
npm run start:repositories
```

The HTTP caller cannot select arbitrary server database paths. The database is opened read-only in a consistent SQLite read transaction. Preview the desired legacy requirement IDs, review the mapping and warnings, then apply with `input.planDigest` and `input.acknowledgeUnverified: true`.

```text
scripts/spec/legacy-preview.mjs -> legacy.preview
scripts/spec/legacy-import.mjs  -> legacy.import
```

Original Gherkin/SD heads and all selected document versions are preserved. Original test code is archived as `.ts.txt`, not auto-loaded as executable tests. New test entry points fail explicitly until case IDs, project bindings, steps and hooks have been reviewed and wired. Previous confirmations are archived but not activated. Imported features start unconfirmed.

Available screenshots are copied only from the configured artifact root after path and SHA-256 checks. Missing or unsafe images produce explicit warnings, not invented evidence. Old run metadata is saved as `reports/<REQ>/<feature>/LEGACY-<id>/legacy.json`, with verification `UNKNOWN`. A missing tested commit stays null; an old `PASSED` status never becomes a current verified run. These legacy archives are intentionally not accepted as sealed modern run manifests.

A private, content-addressed backup of the selected exported data is saved before applying files. This is a selection backup, not a claim that the entire legacy database was backed up. The source database is never changed. Existing destination requirements are not merged or overwritten. Server credentials, agent settings and environment snapshots are excluded; original documents may still contain sensitive user-authored text and must be reviewed before Git publication.

## Report reindexing and artifact access on another machine

After an explicit Git Fetch, choose **rebuild report index** or execute `scripts/run/reindex.mjs` (`reports.reindex`). By default the importer examines HEAD and already-fetched `origin/evidence/*` / local `evidence/*` branches. `input.refs` can select a bounded set of refs. The operation never fetches implicitly, switches branches, resets the index, or changes the developer's dirty files.

Reports are read from immutable Git blobs directly, including binary screenshots. Symlink/executable report entries, excessive files/bytes, mismatched IDs, invalid seals, unexpected files and missing/altered artifacts are rejected. The tested source commit must be an ancestor of the report commit. Valid report bundles are cached under `WB_HOME/report-cache/` and indexed in SQLite. Therefore a new workstation can display reports and screenshots without the original execution directory or database.

The key is workspace + requirement + feature + run, not run ID alone. Different content reusing that identity is quarantined as a conflict. The API can select an indexed bundle with `reportKey`; all lookups remain bound to their workspace. Indexed HTML is downloaded rather than executed inside the management origin.

A historical `VERIFIED` report is not sufficient to label today's feature verified. The feature's current confirmed source/test digest and all project commits must match, and the projects must be clean at their gitlinks. Otherwise the page displays `STALE` or `NOT_VERIFIED`. Selected-case reports cannot grant full verification. Adding only report files does not invalidate a source baseline.

## Database and compatibility

The operational metadata database upgrades additively from schema 1 to 2, preserving workspace/operation/run records. The new `report_index` is a derived cache; it is recoverable from Git. Workspace registration, uncommitted migration journals and running operations still require backups.

Configuration remains JSON-compatible YAML, rather than an unrestricted YAML parser. Nested submodules, multiple managed service deployment attestations, remote authentication/ACL, OS-level execution isolation and automatic migration of Agent/MCP sessions remain outside this iteration. Legacy source import is deliberately review-gated instead of guessing equivalent executable tests.

## Validation semantics

The core regression suite includes failure injection for interrupted upgrades, manual-edit/HEAD conflicts, legacy schema variants, hash errors, missing images, binary Git artifact round trips, fresh-clone report recovery, duplicate-run quarantine, stale verification and real HTTP artifact delivery.

The separate browser test installs actual pinned Playwright/BDD dependencies, builds a temporary versioned HTTP product as a submodule, performs real Gherkin-driven browser actions and assertions, checks step screenshots, publishes a separate report commit, and opens the actual management page to view that evidence. It validates this new workstation workflow, not all historical product Gherkin scenarios. CI receipts and browser evidence are retained as workflow artifacts for three days.
