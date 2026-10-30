# Git-backed BDD workstation v1 — implemented scope

This change adds an executable Git-backed management path to Repo A (`bdd`). It does not delete the existing SQLite-document workflow or migrate its data automatically. Repo B remains a separate repository; registering, cloning, initializing, committing and pushing it are separate user operations.

## Entry points

Use Node.js 24 (the existing repository engine requirement) and Git. The new core uses only Node built-ins and does not add npm dependencies.

```sh
# Start the new management surface without loading the legacy native dependencies.
npm run start:repositories
# http://127.0.0.1:4180/repositories

# In an existing full installation, normal build/start also mounts it at:
# http://127.0.0.1:4173/repositories
npm run build
npm start

npm run check:workstation
npm run test:workstation
```

The old UI links to the new page. The integrated server dynamically loads `packages/workstation/` from the repository root, so deploy the complete checkout, not `dist/` alone. `WB_ROOT` retains its existing meaning.

`WB_HOME` defaults to `~/.bdd-workstation` and is independent of the old `.workbench/metadata.sqlite`. Back up both databases during transition. The new home contains `metadata.sqlite`, `workspaces/<id>/repo`, `executions/<run-id>/{repo,scratch,evidence}`, and `publishers/<run-id>/repo`. Do not commit this directory.

## Ownership and source layout

Repo A owns `packages/{contracts,git-core,spec-toolkit,workstation}`, `scripts/`, and `templates/spec-repo/v1`. CLI wrappers and the HTTP worker use the same Git implementation; there is no second shell implementation.

A newly initialized Repo B contains:

```text
workbench.yaml
.gitmodules
package.json
bdd.config.ts
playwright.config.ts
.workbench-tools/                 # versioned, hashed portable toolkit snapshot
spec/<REQ>/<feature>/             # feature.yaml, .feature, .sd.md
spec/<REQ>/requirement.yaml
spec/<REQ>/review.json
tests/_shared/bdd.ts
tests/<REQ>/<feature>/            # .steps.ts, .hooks.ts, fixtures/, support/
reports/<REQ>/<feature>/<run-id>/ # manifest, seal, reports, screenshots, traces
reports/_runs/<run-id>/summary.json
projects/<project-id>/            # real gitlink, not a copied directory
.generated/                      # ignored generation output
.runtime/                        # ignored preview output
```

`workbench.yaml`, `feature.yaml`, and `requirement.yaml` deliberately use JSON syntax, a YAML 1.2 subset. General YAML syntax is rejected explicitly; the application never evaluates a configuration file to parse metadata. Executable BDD configuration and commands are loaded only in the explicitly enabled trusted worker.

`workbench.yaml` records project ID and path, `.gitmodules` records the URL, and Git gitlinks are the authoritative pinned project commits. A run manifest records the actual versions as evidence, not a second editable lock file.

Initialization copies a fixed toolkit snapshot into Repo B and hashes it. Repo B's preview CLI imports this snapshot, never `projects/bdd/src`. Updating the workstation does not silently update existing Spec Repos. An automatic toolkit/schema migration command is not implemented yet.

## Getting started with bdd-spec

On the management page register `git@github.com:Xing00000/bdd-spec.git` (or an allowed HTTPS URL), then explicitly Clone and Initialize. Initialization rejects nonempty repositories. SSH credentials come from the trusted host's agent and known-host setup; credentials are not stored in the registry. HTTPS credential-provider integration is not included in v1. Global/system Git config is intentionally ignored.

Create a feature, edit its Gherkin/SD/steps/hooks, and review the generated diff before committing. Scaffolds throw `UNIMPLEMENTED_ACCEPTANCE_STEP`: they cannot pass as empty tests.

For each product, provide project ID, allowed remote URL and a **full commit SHA**. Add Submodule stages the gitlink and modifies `workbench.yaml`; it does not commit or push. Restore Submodules returns to the recorded gitlinks; Pin changes an explicitly selected project version. They are different operations. Create a project branch before development: checkout-mode submodules normally have detached HEAD.

In Repo B, install the pinned dependencies, generate and review a real lockfile, and install required Playwright browsers:

```sh
npm install
npx playwright install chromium
# Review and commit package-lock.json, do not invent a lockfile.
npm run bdd:validate
npm run bdd:generate -- REQ-001 login
npm run bdd:list -- REQ-001 login
npm run bdd:test -- REQ-001 login
```

These are previews and do not grant formal verification. Repo B owns its dependency installation. The workstation does not borrow its own `node_modules` for product tests.

Commit product changes in the product repository, explicitly push that branch, pin its SHA in Repo B, then commit and push the Spec candidate. No operation automatically merges branches, force pushes, resets a dirty worktree, or pushes changes during a file save.

## Programmatic and CLI contract

`node scripts/workstation.mjs help` lists operations. All non-server commands read one JSON object from stdin and emit one JSON result to stdout. Diagnostics use stderr. `WB_REPOSITORY_PORT` controls the standalone server port (default 4180); it binds loopback only.

```sh
printf '%s' '{"id":"WS-bdd","title":"BDD Spec","remoteUrl":"git@github.com:Xing00000/bdd-spec.git"}' \
  | node scripts/workstation.mjs register
printf '%s' '{"workspaceId":"WS-bdd","operationId":"OP-clone-1"}' \
  | node scripts/git/clone.mjs
printf '%s' '{"workspaceId":"WS-bdd"}' \
  | node scripts/git/inspect.mjs
```

Other wrappers live in `scripts/git`, `scripts/spec`, and `scripts/run`. Mutating requests include `expected.head` from the last inspection (null for an unborn repository). `expected.branch` and `expected.fingerprint` strengthen optimistic concurrency. A selected commit request is:

```json
{
  "schemaVersion": 1,
  "operationId": "OP-commit-1",
  "workspaceId": "WS-bdd",
  "operation": "git.commit",
  "expected": {"head": "<inspected-full-SHA>", "branch": "main"},
  "input": {"paths": ["spec/REQ-001/login/login.feature"], "message": "Define login acceptance"}
}
```

Replace the placeholder with the actual inspected SHA. For a product Git operation add `target: {"kind":"project","projectId":"bdd"}`. Callers cannot provide an arbitrary server repository root or arbitrary shell command.

HTTP endpoints under `/repository-api/v1` provide capabilities, workspaces, file reads, Git inspection, operation submission/status/cancellation, and run artifacts. Write requests require `Content-Type: application/json`, `X-Workbench-Request: 1`, and a matching Origin when present. Long operations return 202 and a durable operation ID; poll its status. Only one writer per workspace is allowed. The same operation ID and payload returns its existing receipt; reusing that ID for different input fails.

Cancellation retains the workspace lock in `CANCELLING` until the actual worker exits. Dead workers are marked interrupted, not successful. Partial Git writes are retained for inspection. An interrupted execution requires a new run ID. A publisher interrupted before recording its commit requires explicit inspection; it is not automatically deleted or overwritten.

## Confirmation and verification

Confirmations are per-feature content digests, not whole-repository HEADs. Gherkin changes invalidate downstream confirmation; SD changes invalidate test confirmation; shared tests/config/lock/toolkit changes invalidate affected tests. Adding reports does not invalidate source confirmation. Normal project commits require new verification but do not automatically revoke Gherkin approval.

A formal run requires a clean committed Spec candidate, confirmed current inputs, a committed package lock, and initialized clean submodules matching their gitlinks. Preparation creates an independent clone at S; it does not use linked worktrees containing submodules. Nested submodules are rejected in v1 rather than recursively fetching unvalidated URLs.

Execution is **off by default**. Set `WB_ENABLE_TRUSTED_EXECUTION=1` only on a trusted isolated host/container. A cwd, process group, sanitized environment and child process are not an OS sandbox. No untrusted multi-tenant execution or public ACL system is claimed.

The committed `execution` configuration supports install/prepare/teardown executable-argument arrays, public environment settings, and one managed product service. The service runs from a pinned product checkout. Its dedicated loopback health endpoint must return JSON with `commit` equal to that SHA, and `WB_TARGET_BASE_URL` must use the same origin. A pre-existing responder is rejected. External deployments without a trusted receipt remain `DEPLOYMENT_UNPROVEN`. V1 cannot certify multiple simultaneously required product services with its single-service adapter.

Each feature executes in a separate process and loads only global shared tests, requirement shared tests and that feature's tests. Stable `@case:CASE-ID` tags or Scenario Outline `case_id` columns map cases to browser profiles. The full discovery matrix must match metadata. Formal completion requires actual expect assertions, every mapped BDD step's screenshot, exactly the selected executions, no skipped/retried tests, unchanged inputs and matching deployment. Selected-case runs never qualify as full verification.

This policy checks traceability and receipt consistency; it does not prove that deliberately malicious tests or a dishonest health endpoint are truthful, or that assertions cover all business meaning.

## Reports and publication

Playwright writes to per-run scratch directories, never an existing `reports/` root. The worker preserves JSON, HTML, native HTML attachments, logs, step events, screenshots and traces in an immutable sealed bundle. Screenshots are scoped by case, browser profile and attempt. Hashes and the exact artifact set are validated before viewing/publishing. HTML is downloaded, not embedded as active content in the site.

Publishing uses a separate clone and `evidence/<run-id>` branch. Commit R contains only reports and records **testedSpecCommit S**. It does not claim that R was tested and does not alter the developer's current worktree. Creating R and pushing R are separate operations; retrying a completed publication reuses R. Publication failure does not rewrite the recorded test outcome. Existing runs are never overwritten.

V1 stores evidence in Git, limits individual evidence files to 32 MiB and bundles to 256 MiB. Git LFS/object-store upload and retention management are not implemented. Reports may contain sensitive page data and logs: review them before explicit publication. No automated secret detector is claimed.

## Validation and remaining migration work

`tests/workstation` executes actual temporary Git repositories, local bare remotes, submodules, independent clones, processes, SQLite journals, CLI commands and HTTP requests. Reporter policy tests use clearly labeled protocol fixtures, not fake product E2E results. The intentional failing runner test checks that a real failed command seals NOT_RUN evidence.

During this implementation these tests ran on the available Node 22.16.0 runtime with experimental `node:sqlite`; production remains Node 24 as required by `package.json`. The environment could not install the existing dependencies or run a real Playwright browser, so full legacy typecheck/build, Node 24 execution, browser UI E2E and product acceptance were not locally verified. Run those checks in the deployment/CI environment before rollout.

Still separate from this v1: automatic legacy SQLite-document export/migration; replacing all old UI/MCP/Agent paths with Git-backed resources; arbitrary YAML; nested submodules; multiple-service/external deployment attestation; report discovery/reindex from other machines; general merge/PR and schema migration workflows; packaged release distribution; OS-level execution isolation. The legacy workflow remains available until those migrations are explicitly implemented and verified.
