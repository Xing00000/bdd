# Spec / Tests / Reports workspace

`spec/<REQ>/<feature>`, `tests/<REQ>/<feature>` and `reports/<REQ>/<feature>/<run-id>` are parallel namespaces. `projects/<id>` must be Git submodules. Product SHAs live in gitlinks, not a duplicate editable lock file.

Configuration files ending in `.yaml` use JSON syntax (a YAML 1.2 subset) in schema v1. The toolkit deliberately rejects other YAML syntax instead of guessing. `.workbench-tools/` is a fixed, SHA-256-verified toolkit snapshot; it does not import the running workstation or `projects/bdd`.

After initialization, run `npm install`, review and commit `package-lock.json`. A formal candidate without a lockfile is rejected. Install the matching Playwright browser binaries separately. Scaffold steps intentionally fail until implemented.

```
npm run bdd:validate
npm run bdd:generate -- REQ-001 login
npm run bdd:list -- REQ-001 login
npm run bdd:test -- REQ-001 login
```

The CLI commands are previews, not formal verification. The workstation's runner creates a separate clone at a fixed commit, checks confirmations, runs discovery and execution, seals evidence and records the tested commit. Reports are published separately and never overwrite the previous run. An external target URL alone does not prove the deployed source revision.

No credentials belong in Git. `workbench.yaml` execution commands are executable code: review them and use an isolated, trusted worker. A working directory is not an OS sandbox. `execution.environment` only accepts explicitly allowed public keys; private environment variables are not inherited.
