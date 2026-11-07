# Session Management v2 — implemented core and integration gates

Spec: `Xing00000/bdd-spec` PR #1, `REQ-WB-102/session-management`.
Base reviewed: `c8336f17269d70c573c1e3445ca0b5e3b7cf6536`.

## What this change actually implements

The existing HTTP server now serves `/repositories/session-management` and
`/repository-api/v1/session-management`. There is no second website/server.
The same `WB_HOME/metadata.sqlite` receives additive `sm_*` tables and an
independent migration ledger. Existing tables, `user_version`, chat and execution
routes are not migrated, rewritten or silently remapped.

- Workstation-scoped projects; physical Repo identity and project associations.
- Immutable Skill, Soul, Bot, ACP Profile, Workflow and Output Contract revisions.
- Soul role tags/thinking style/avatar asset reference/Skill configuration; stable
  logical long-term memory ID. The asset reference is stored, not an image uploader.
- Task creation atomically reserves one Workflow snapshot, one room, one Worktree
  and a `(bot, task)` logical Session map. It then provisions a **real Git Worktree**
  outside the SQLite transaction. Only successful verification marks it READY.
- Workflow dependency validation, active stage participants, frozen Bot/Soul/Skill/
  profile definitions, native Session generations and per-source cursors.
- Fixed result contracts, immutable candidates/results and digest-bound human gates.
  This is schema/invariant verification, not a substitute for actual test evidence.
- Human task messages with idempotency and QUEUED receipts; no invented model replies.
- Human-approved, source-linked project summaries; explicit promotion to workstation
  scope, deduplication, 2,000-character limit and 200-summary per-scope cap.
  No automatic LLM extraction, no transcript copy and no automatic memory eviction.
- Persistent Worker reservations, per-node concurrency/total/turn limits, workstation
  concurrency limit and a single writing Worker per task. UNKNOWN consumes capacity.
- Secretary portfolio projection: project/task/node states without transcript or memory.

## Not implemented by this change (keep the PR Draft)

The new task model is **not yet a complete autonomous multi-Bot product**.
`GET .../capabilities` explicitly reports:

```
nativeRuntimeDispatch: false
workerDispatch: false
acceptanceCheckpoint: false
```

The internal controller commands (`node.start`, `runtime.attach`, `node.submit`,
`worker.*`, `worktree.ready`) are not accepted by the human HTTP command endpoint.
Tests inject controlled controller/native-session receipts to verify state rules;
those receipts are not presented as real SDK/model execution.

Remaining integration: bind new BotTask sessions to the official Codex SDK wrapper,
provide native MCP capabilities bound to task/node/generation, connect reservations
to the existing ACP/PTY Supervisor (including trustworthy shutdown receipts),
actually deliver/acknowledge task messages, add the root-room scheduler, and integrate
real test evidence plus final human-acceptance Git checkpoints. Claude profiles are
configuration only until a real adapter passes its compatibility suite. Avatar upload,
automated memory extraction/compaction, full UI E2E, and legacy-data mapping remain.
Do not route around these gates by calling old unrestricted execution endpoints.

## Core API

`SessionManager(file, {workstationId, worktreeRoot, maxWorkers})` exposes
`command(name, input, {actor,requestId})` and scoped read projections. The default
HTTP deployment is a private loopback single-user workstation, **not** a multi-user
ACL system. Role tags are not authorization. The server derives human identity;
request bodies cannot choose it. Future Bot MCP credentials must carry immutable
node/task/generation bindings. Do not expose `command` as an unrestricted RPC tool.

All commands are synchronous, short `BEGIN IMMEDIATE` transactions. Unique constraints
and a canonical request digest provide replay safety. An idempotency key with different
input fails. A stale Runtime generation cannot advance cursors, submit output, send
Bot messages, or reserve more Workers. Native session IDs cannot be shared across tasks.
One Bot cannot concurrently run two nodes on its one logical Task session; separate
Bot definitions are needed for truly independent parallel contexts.

The result publisher stores result + state + `result.published` event atomically.
A consumer resumes from room `seq` (the event table is the durable delivery log).
This does not promise exactly-once external effects. Worker cursor streams are separate.
Existing complete results remain immutable; requirement revision/replanning needs a
new explicit execution model and is not exposed as a silent edit API in this slice.

Output validation supports a closed JSON Schema 2020-12 subset: explicit types,
closed objects/properties/required, arrays/items/bounds, string length, number bounds,
enum and const. Unknown keywords, remote `$ref`, combinators and open objects are
rejected at registration. It is not a purported full JSON Schema implementation.
There is no coercion and schema-valid `accepted:false` remains false.

## HTTP commands and views

`POST /repository-api/v1/session-management/commands`:

```json
{"command":"project.create","input":{"name":"Example"},"requestId":"unique-command-id"}
```

Requires `X-Workbench-Request: 1` and same-origin checks. Human commands are
`project.create`, `repository.register`, `repository.link`, `catalog.save`,
`task.create`, `task.cancel`, `room.message`, `memory.summarize`, `node.approve`.
Internal execution receipts are rejected with 403.

GET root returns the local catalog and task list. Other reads: `/portfolio`,
`/tasks/:id`, `/tasks/:id/events?afterSeq=0&limit=200`, `/nodes/:id`,
`/memory/:soulId?projectId=...`, `/capabilities`.
`POST /tasks/:id/provision` explicitly retries only task creation.

## Git boundary and crash safety

Registering a Repo does not run Git. It canonicalizes an existing local path.
`provisionTaskWorktree` is the FEATURE_CREATE boundary. It verifies the repository
root, pins HEAD, creates a generated task branch/path, checks the actual checkout,
and only then records a trusted receipt. Hooks are disabled for this checkpoint;
it is not an OS sandbox for arbitrary Git filter drivers in a trusted repository.
Normal reads, messages, memory writes, transitions and cancellation invoke no Git.
Cancelled worktrees remain CLEANUP_PENDING; no hidden remove/reset/clean.

A failed creation retains its task and error. A retry may adopt an existing directory
only when repository common-dir, branch and pinned SHA all match. A RUNNING checkpoint
is never stolen merely because its deadline expired: a dead parent does not prove
its Git child stopped. Operator reconciliation is required after a hard crash during
that window. No destructive automated cleanup or forced branch reuse is performed.

Worker profiles alone cannot enforce zero Git for an unrestricted CLI. Strict execution
needs an OS-enforced workspace/tool boundary before enabling the new dispatch adapter.

## Verification

Run with supported Node 24:

```sh
node --test tests/workstation/session-management*.test.mjs
```

The suite uses real SQLite files, a real HTTP socket, competing OS processes and real
Git worktrees in temporary repositories. Runtime/controller identities in state tests
are explicit fixtures, not native SDK/model proof. No external model credentials are
needed and there are no skipped tests. The dedicated CI job runs on Node 24 without
npm dependencies; the existing repository CI still owns build/full regression.

The authoring environment ran Node 22.16.0 (SQLite experimental). Full repository
build/npm installation and browser/model E2E were not run because dependency download
was unavailable. See the PR for the actual executed count and results; never infer
passing native SDK tests from these state tests.
