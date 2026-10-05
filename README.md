# pi-usage-audit

Local, zero-dependency Pi usage ledger. Requires Node 22.20+ (`node:sqlite` is experimental). Explicit-file CLI and API; no dashboard.

Project status and next steps: [roadmap and progress](ROADMAP.md).

## Quick start

Run synthetic tests: `npm test`. No installation is required.

Import only files you explicitly select (session/task flags are repeatable):

```sh
node src/cli.js --help
node src/cli.js import --db /outside/repo/usage.sqlite --session /selected/session.jsonl --task /selected/task.json
```

Tasks-only imports are allowed for later joins. Omit `--db` for the default outside-repository storage shown below. There is no auto-discovery. JSON output contains `report`, confirmed-own `ranking`, and `coverage` (historical `imports` and current `accounting`).

Exit codes: **0** success/help, **2** argument errors, **1** operational failure. All arguments are checked before storage opens; help, missing arguments and invalid flags create no database directory. Operational errors are generic, without paths or exception payloads. Unreadable selected sources roll back the whole import and the database closes; failed opens may still create storage. Malformed JSON lines/tails are reported and skipped, not operational failures.

Or use the ESM API:

```js
import { openLedger } from './src/ledger.js';
const ledger = openLedger(); // default: ~/.local/state/pi-usage-audit/usage.sqlite
try {
  const report = ledger.importFiles({
    sessions: ['/absolute/path/to/selected-session.jsonl'],
    tasks: ['/absolute/path/to/selected-task.json'],
  });
  console.log(report, ledger.ranking());
} finally { ledger.close(); }
```

Pass a database filename to `openLedger(filename)` to override storage. Keep it outside your repository. No directory discovery or parent-file auto-reading occurs. Relative import paths use the caller's working directory; relative `task.sessionPath` and header `parentSession` use their containing file's directory.

## Accounting and coverage

- Version 2/3 sessions: finalized assistant usage, standalone `usage` (including unknown kinds), compaction and branch-summary usage. Effective provider/model comes only from the usage-bearing record; missing values remain null. Streaming/pending messages are excluded.
- `entries()` exposes operation, token categories, subset counters, certainty and runtime estimates. `ranking()` sums **confirmed own** entries globally by agent, never task totals or parent tree totals. Reasoning/output and cacheWrite1h/cacheWrite are not added twice. Incomplete or inconsistent token records are excluded, not invented as zero.
- Nested tool-result usage is retained as `nested-unknown`, excluded from own ranking because child overlap is unproven. Unknown attribution is not called orchestrator. Durable task joins survive restart; continuations reuse the session ledger. Conflicting continuation agents remain unknown without time evidence.
- Explicit task `project`/`feature` labels are supported. Otherwise `cwd` yields an opaque workspace identifier, not repository/worktree grouping. Conflicting or missing labels remain unknown.
- Session+entry uniqueness makes reimport idempotent. Different files claiming the same session ID are conservatively `session-ambiguous`. Changed entry evidence is permanently quarantined; inspect rather than overwrite identities.
- Fork reconciliation requires explicitly imported parent lineage, retained local ID, matching timestamp and keyed usage/content evidence, ignoring changed parentId. Known copies are excluded before considering anything else. Unmatched child IDs remain `lineage-unresolved`, even with a clean earlier parent import: append-only parents can grow. Header/entry timestamps alone are not trustworthy origin proof; genuine SDK child usage remains observed but unconfirmed too. Missing parents/cycles are unresolved until sufficient evidence arrives. Old database `complete:*` flags are ignored without migrations or deletion. Same-ID evidence disagreements are conservatively `lineage-conflict`, so legitimate short-ID collisions may be omitted. No global token-count/text-hash deduplication; unmarked copies cannot be detected. Multi-level explicit lineage is followed, but this unit tests only one-level forks.
- `accounting()` exposes current certainty counts and `uncertain` entry counts, observed token categories and missing-category counts. These observations may overlap confirmed or other uncertain records: `additive: false`, **not an additive global total**. Reasoning and cacheWrite1h remain subsets, not extra tokens. Missing categories are separately counted, not evidence of zero usage. Ownership coverage is separate from actor attribution: a confirmed own entry can still rank under `unknown`.
- `importFiles()` returns coverage counters; `coverage()` retains historical import reports, including current-ledger certainty counts at import time. Malformed lines/tails are skipped and recoverable by reimport, with no raw-line logging. An empty/unsupported source is incomplete. These are observed totals, **not complete billing totals**.
- Runtime cost totals retain `runtime-estimate` provenance, not invoice truth. Missing estimates are null and counted separately; a partial sum does not imply complete cost coverage. No manual price tables or currency conversion.

## Privacy and boundaries

Only whitelisted accounting/attribution metadata, opaque path keys and keyed copy fingerprints are persisted. No raw prompts, responses, summaries, tool arguments/results, task threads, credentials or source paths. Identifiers and caller-provided labels are metadata: do not put secrets in them. Fingerprints are derived evidence, not transcript exports; protect the database and sidecars as private local data.

SQLite uses WAL, a 5-second busy timeout, initialization retries, transactions and unique insert keys. Public `entries()`, `ranking()` and `accounting()` each use a deferred read transaction; the import's internal snapshot stays inside its write transaction. Separate API calls/output fields are not one combined snapshot. Tests use synthetic fixtures only and independent concurrent processes with overlapping/disjoint inputs. Tests leave synthetic artifacts under ignored `test/.runtime-*/` directories; these can be removed after verification.

Deferred: trustworthy child-origin evidence (block 2), automatic discovery/live `message_end`, dashboard, automatic model changes, manual pricing, repository/worktree grouping and task-time attribution. Files are read fully into memory; this is not yet a large-history streaming importer. No real-session validation, publication or license selection has occurred.

Rollback units for this block: (1A) ledger and audit/writer regressions; (1B) CLI, CLI tests and package test command; accompanying README/roadmap progress. Preserve earlier ignore/documentation changes. Local databases are separate and never migration/deletion targets.
