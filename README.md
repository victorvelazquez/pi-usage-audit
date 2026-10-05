# pi-usage-audit

Local, zero-dependency Pi usage ledger. Requires Node 22.20+ (`node:sqlite` is experimental). No dashboard or CLI yet.

## Quick start

Run synthetic tests: `npm test`. No installation is required.

Import only files you explicitly select, using the ESM API:

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
- Fork reconciliation requires explicitly imported parent lineage, retained local ID, matching timestamp and keyed usage/content evidence, ignoring changed parentId. Copies are excluded; new IDs count as own. Missing parents/cycles are `lineage-unresolved` until resolved. Same-ID evidence disagreements are conservatively `lineage-conflict`, so legitimate short-ID collisions may be omitted. No global token-count/text-hash deduplication; unmarked copies cannot be detected. Multi-level explicit lineage is followed, but this unit tests only one-level forks.
- `importFiles()` returns coverage counters; `coverage()` retains historical import reports, including current-ledger certainty counts at import time. Malformed lines/tails are skipped and recoverable by reimport, with no raw-line logging. An empty/unsupported source is incomplete. These are observed totals, **not complete billing totals**.
- Runtime cost totals retain `runtime-estimate` provenance, not invoice truth. Missing estimates are null and counted separately; a partial sum does not imply complete cost coverage. No manual price tables or currency conversion.

## Privacy and boundaries

Only whitelisted accounting/attribution metadata, opaque path keys and keyed copy fingerprints are persisted. No raw prompts, responses, summaries, tool arguments/results, task threads, credentials or source paths. Identifiers and caller-provided labels are metadata: do not put secrets in them. Fingerprints are derived evidence, not transcript exports; protect the database and sidecars as private local data.

SQLite uses WAL, a 5-second busy timeout, initialization retries, transactions and unique insert keys. Tests use synthetic fixtures only and independent concurrent processes with overlapping/disjoint inputs. Tests leave synthetic artifacts under ignored `test/.runtime-*/` directories; these can be removed after verification.

Deferred: CLI, automatic discovery/live `message_end`, dashboard, automatic model changes, manual pricing, repository/worktree grouping and task-time attribution. Files are read fully into memory; this is not yet a large-history streaming importer. No real-session validation, publication or license selection has occurred.

Rollback unit: the package manifest, ledger, synthetic tests and README plus the audit-specific ignore additions; local databases are separate and never migration/deletion targets.
