# pi-usage-audit

Local, zero-dependency Pi usage ledger. Requires Node 22.20+ (`node:sqlite` is experimental). Explicit-file CLI and API; delivered localhost dashboard, candidate evolution API.

Project status and next steps: [roadmap and progress](ROADMAP.md).

## Synthetic dashboard demo

```sh
node src/dashboard.js --demo
node src/dashboard.js --demo --port 8080
node src/dashboard.js --help
```

Open the printed `http://127.0.0.1:<effective-port>/` yourself; port defaults to 0.
Stop with Ctrl+C. Only this exact host and GET `/` are accepted; no query routes.
The permanent demo banner identifies synthetic data, not real usage or capture.
The server reads only the checked-in fixture: no SQLite, tariffs, external calls,
client scripts or new dependencies. Errors omit paths and request values.

Agent/model views share entries and are nonadditive. Tokens remain exact strings.
Manual group costs show explicit EUR, complete coverage or null with API reasons;
known zero is distinct from missing. No subtotal, global money total or money ranking.
Runtime amounts remain separate with unknown currency/total. No conversion or invoice claim.
Fixture equivalence is tested against a fixed in-memory synthetic ledger.
Demo delivered in PR #17 (`8873088`); selected-database UI delivered in PR #19 (`f8c87b2`).

## Selected-database dashboard (delivered PR #19)

```sh
node src/dashboard.js --db /explicit/existing.sqlite --currency EUR
node src/dashboard.js --db /explicit/existing.sqlite --currency EUR --port 8080
```

Currency is required: exactly three uppercase ASCII letters, without inference or
conversion. Demo cannot combine with database/currency flags. Duplicate, missing
or invalid arguments fail before opening storage or listening; help opens neither.
Exit codes are 0 for help/success, 2 for arguments, 1 for sanitized operational errors.
The same loopback, Host/Origin/Fetch-site restrictions and CSP protect both modes.

The selected-base banner is not a claim of verified real-session data. One
`dashboardReport({currency})` snapshot supplies runtime and costs together;
projection retains summaries, not IDs or selected prices, without repricing.
The reader closes before listen, including report/render failures. HTML stays
static until restart: no refresh, capture, discovery, external calls or tariff UI.
Opening never creates/initializes/repairs a base. SQLite readonly may use WAL/SHM;
this is not a guarantee of zero physical filesystem effects. Labels remain
user-provided metadata: do not store secrets in them. Validation uses synthetic
bases only; real-session and visual browser validation remain pending.

## Readonly dashboard reports (API delivered PR #18)

`openReadonlyLedger(filename)` from `src/ledger.js` requires an explicit existing
SQLite file initialized by `openLedger`. It returns only `{ dashboardReport, close }`:
no database handle, imports or pricing writes. Opening uses `readOnly: true` and
`timeout: 5000`; schema columns/primary keys and the stored fingerprint key are
checked by reads. Missing, empty, corrupt or incompatible storage fails with
`Readonly ledger open failed`, without directory creation, initialization or repair.

`reader.dashboardReport({ currency: 'USD' })` returns `{ runtime, costs, evolution }`
(`evolution` is a candidate addition); existing runtime/cost shapes are unchanged.
All three reports use **one deferred transaction** spanning
entries, lineage, task attribution and tariffs. Exactly one own currency key is
required; three uppercase ASCII letters, no default/conversion. Invalid requests
fail before SQL (`Invalid dashboard report`); operational failures reject the
whole result (`Dashboard report operation failed`). Close the reader in `finally`.

Readonly does not mean filesystem-immutable: SQLite may create/use WAL/SHM
sidecars. No WAL configuration, `immutable` mode, key writes or repair occurs.
This API was delivered in PR #18 (`7d924e4`); it does not authorize real sessions.

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
- Fork reconciliation requires explicitly imported parent lineage, retained local ID, matching timestamp and keyed usage/content evidence, ignoring changed parentId. Known copies are excluded before considering anything else. Unmatched child IDs remain `lineage-unresolved`, even with a clean earlier parent import: append-only parents can grow. Header/entry timestamps alone are not trustworthy origin proof; genuine SDK child usage remains observed but unconfirmed too. Missing parents/cycles are unresolved until sufficient evidence arrives. Old database `complete:*` flags are ignored without migrations or deletion. Same-ID evidence disagreements are conservatively `lineage-conflict`, so legitimate short-ID collisions may be omitted. No global token-count/text-hash deduplication; unmarked copies cannot be detected. Multi-level explicit lineage is followed; synthetic regressions include three levels, late ancestors and restart.
- `accounting()` exposes current certainty counts and `uncertain` entry counts, observed token categories and missing-category counts. These observations may overlap confirmed or other uncertain records: `additive: false`, **not an additive global total**. Reasoning and cacheWrite1h remain subsets, not extra tokens. Missing categories are separately counted, not evidence of zero usage. Ownership coverage is separate from actor attribution: a confirmed own entry can still rank under `unknown`.
- `accounting().breakdown` adds rows grouped by `operation`, `certainty` and `attributionEvidence`, covering every persisted entry (including copied and quarantined entries). Each row has `entries`, `additive: false`, `observed` token categories and `missing` category counts. All-missing categories are null; partial observations sum only known counters. Legacy accounting fields and ranking are unchanged. The CLI exposes this under `coverage.accounting.breakdown`.
- Attribution evidence describes joined **task metadata only**: `no-task` (no joins), `conflicting-agents` (multiple distinct nonnull agents, taking precedence over missing agents), `missing-agent` (at least one null agent without conflict), or `task-consensus` (all tasks agree on one nonnull agent). Continuations do not multiply entry counts. These are not proven roles, orchestrator/subagent identities, or trustworthy child-origin evidence. Deleted/unimported task metadata cannot be reconstructed. The existing literal `unknown` label/sentinel collision remains a legacy attribution limitation.
- `importFiles()` returns coverage counters; `coverage()` retains historical import reports, including current-ledger certainty counts at import time. Malformed lines/tails are skipped and recoverable by reimport, with no raw-line logging. An empty/unsupported source is incomplete. These are observed totals, **not complete billing totals**.
- Runtime cost totals retain `runtime-estimate` provenance, not invoice truth. Missing estimates are null and counted separately; a partial sum does not imply complete cost coverage. Manual catalogue rates do not change these totals; no currency conversion.

## Global tokens by provider/model (API only)

`ledger.modelUsage({})` reads current imported confirmed-own usage globally.
The empty object is required; missing/null/array requests or any extra own key
(including symbols/nonenumerable keys) fail before SQL: `Invalid model usage`.

It returns `{ provenance: 'imported-own-model-usage', groups, coverage }`:

- Each group has `provider`, `model`, `entries`, `sessions` and `tokens`.
  Tokens contains exactly `input`, `output`, `cacheRead`, `cacheWrite`,
  `totalTokens`: canonical nonnegative decimal **strings**, summed exactly with
  BigInt beyond Number's safe range. Reasoning/cacheWrite1h are not added again.
- Identities are the observed persisted strings, preserving case and whitespace;
  missing/empty identities are null, distinct from any literal display label.
  No catalogue validation, aliases or task-derived identity applies.
- Groups sort by exact total tokens descending, then provider/model in
  case-sensitive UTF-8 binary order, null first. `entries` counts records, not
  calls/successes. `sessions` counts distinct session IDs per group; sessions
  across different models are **not additive**.
- Coverage has `includedEntries`, `excludedEntries`, `excludedByCertainty`.
  Only dynamic `own` records contribute tokens; every other certainty is counted
  separately, not assigned zero tokens. Empty storage returns `groups: []`, zero
  entry counts and an empty exclusion object. Invalid stored own counters fail
  the entire operation rather than becoming zero or being reclassified.

One deferred read transaction classifies and sums one sources/entries snapshot;
late lineage/conflicts affect fresh calls. Results are detached, with no writes,
new schema, task/attribution reads, costs, pricing or invoice inference. Operational
and rollback errors are generic: `Model usage operation failed`. Existing APIs
and CLI outputs are unchanged; no dashboard, live capture or automatic model policy.

## Daily token evolution (unit A candidate, not delivered)

`ledger.tokenEvolution({})` requires an object with zero own keys, including
symbols/nonenumerable keys; invalid requests fail before SQL (`Invalid token evolution`).
It returns `{ provenance: 'imported-own-token-evolution', granularity: 'day',
timezone: 'UTC', buckets, undated, coverage }` from one deferred read snapshot.

- Only dynamically confirmed-own entries contribute, classified before dates.
  Coverage matches runtime: `includedEntries`, `excludedEntries`, `excludedByCertainty`.
- Buckets are `{ day, entries, totalTokens }`, ascending UTC `YYYY-MM-DD`.
  Totals use BigInt and exact decimal strings, including explicit zero; counts
  describe persisted records, not calls. No gap filling, costs or token subsets.
- Only persisted outer `entry.timestamp` is used: canonical real UTC
  `YYYY-MM-DDTHH:mm:ss.sssZ`, years 0001–9999. No message/header/current-time fallback.
  Null is missing; every other noncanonical value is invalid, including offsets.
- `undated` has `entries`, `totalTokens`, `missingTimestampEntries` and
  `invalidTimestampEntries`. Buckets plus undated conserve runtime own entries/tokens.
  Empty storage has no buckets, zero counts and string `"0"` undated tokens.
- Invalid stored own counters or inconsistent category/total sums reject the entire
  operation, even undated: `Token evolution operation failed`. Results are detached;
  late ownership evidence affects fresh calls. No tariff or task attribution dependency.

The candidate adds `evolution` to `dashboardReport`'s shared runtime/cost transaction.
Readonly still exposes only `dashboardReport`/`close`, not independent `tokenEvolution`.
No CLI/UI change: evolution UI is future unit B; API-only runtime validation is N/A.
Synthetic tests only; no real-session, native-review or delivery claim.

## Global runtime report (API and CLI)

```sh
node src/cli.js report --db /explicit/existing.sqlite
node src/cli.js report --help
```

Or call `ledger.runtimeReport({})`. Exactly zero own keys are required, including
symbols/nonenumerable keys; invalid requests fail before SQL: `Invalid runtime report`.
The result is `{ provenance: 'imported-own-runtime-report', agents, models, runtime, coverage }`.

- Only current confirmed-own entries contribute. `models` matches `modelUsage({}).groups`, including literal/null identities, exact decimal-string token categories, descending totals and binary UTF-8 ties. Reasoning/cacheWrite1h are not extra tokens.
- `agents` has `agent`, `entries`, distinct `sessions`, and exact decimal-string `totalTokens`; order is descending tokens then binary agent. Attribution is task consensus, not proven roles; the legacy literal `unknown`/sentinel collision remains. Continuations do not multiply usage.
- Agent/model views describe the **same entries**, not additive totals together. Sessions across model groups are nonadditive. `coverage` counts included/excluded entries and exclusions by certainty; excluded usage is not zero.
- `runtime` has `provenance: 'runtime-estimate'`, `currency: null`, `total: null`, and `totalUnavailableReason: 'runtime-currency-not-recorded'`. No monetary sum, ranking, conversion or inferred USD exists in this runtime view; comparative manual costs use the separate report below.
- `runtime.observations` contains individual persisted numeric `amount`s with session/entry/provider/model/agent metadata, ordered by binary session/entry. Decimal precision is not manufactured; zero is recorded, missing amounts are omitted. Its coverage counts `recordedEntries`, `missingEntries`, and `unknownCurrencyEntries` (all recorded amounts).
- Current Pi RPC documentation describes USD-based rates, but cannot attest arbitrary historical producers, custom providers or gateway usage. Imported cost fields contain no currency; they remain unchanged. Manual prices and estimate history are not consulted.

One deferred transaction spans classification, attribution and all views; late evidence
changes fresh reports. Results are detached and the query writes nothing. Corrupt own
counters/amounts reject the whole report; operational/cleanup errors are generic:
`Runtime report operation failed`. Empty storage yields empty arrays, zero counts and null money.
CLI requires an explicit existing regular database; invalid/help/missing-path requests
create no storage. Exit codes remain 0/2/1; errors are sanitized and close is attempted.
**Not wholly read-only:** the existing opener initializes tables/config and WAL even on
existing databases. The filesystem existence check is not an atomic read-only-open guarantee.

## Comparative manual costs (API and CLI)

`ledger.costReport({ currency: 'USD' })` or
`node src/cli.js costs --db /explicit/existing.sqlite --currency USD` returns
`{ provenance: 'imported-own-manual-cost-report', currency, groups, coverage }`.
Exactly one own key is required (symbols/nonenumerable extras rejected); currency
is three uppercase ASCII letters, with no default, inference or conversion.
Invalid requests fail before SQL: `Invalid cost report`.

Groups use literal joint agent/provider/model identities, binary UTF-8 order,
null first, not monetary ranking. Each has `entries`, per-entry `quotes` retaining
session/entry, observation, eligibility reasons and selected prices, plus
`coverage: { complete, completeQuotes, incompleteEntries }` and `total`.
Totals are exact fixed-12 BigInt sums only when every entry has a complete quote;
otherwise null, never a subtotal. Invalid own identity/date/counters remain
incomplete entries; non-own entries appear only in global `coverage` counts
`includedEntries`, `excludedEntries`, `excludedByCertainty`, without global money.

One deferred snapshot spans current classification, task-consensus attribution
and catalogue rates. Each own entry contributes once; continuations do not fan out.
Prices select latest literal category/provider/model/currency `effectiveFrom <=`
the canonical outer entry timestamp, with no fallback date or implicit now.
Missing rates are unknown even for zero tokens; explicit zero rates are known.
Retrospective additions can change fresh reports, not returned copied quotes.
No invoices, runtime sums, historical-alternative sums or persisted estimates.
Operational/rollback errors: `Cost report operation failed`. CLI uses the existing
regular-database check, sanitized errors, close attempt and exit codes 0/2/1;
help/invalid/missing-file requests create no storage. Opener initialization/WAL
means it is not wholly read-only. Pricing remains through the existing API only.

## Opt-in manual price catalogue (API only)

`ledger.addManualPrice({ provider, model, category, currency, effectiveFrom, ratePerMillion })`
returns the canonical record. `ledger.manualPrices({ provider, model, currency })`
returns every version sorted by category, then date; absent prices return `[]`, not zero.
All listed keys are required and unknown keys are rejected; there are no defaults.

- Provider/model are literal, case-sensitive strings of 1–512 characters, without edge whitespace or control/format characters. No aliases or model-name normalization.
- Categories are exactly `input`, `output`, `cacheRead`, `cacheWrite`. `totalTokens` is an aggregate; `reasoning` and `cacheWrite1h` are subsets, not additional charges.
- Currency must be explicit, three uppercase ASCII letters. Any conforming code is accepted without a registry, default USD or conversion.
- `effectiveFrom` is an explicit real UTC date in `YYYY-MM-DDTHH:mm:ss.sssZ`, years 0001–9999. Offsets, invalid leap dates and implicit “now” are rejected.
- Rates are decimal **strings**, matching `^(0|[1-9]\d{0,11})(\.\d{1,6})?$`, from zero through `999999999999.999999`. Stored/returned as six-fraction-digit TEXT using string padding, never floating-point costs. Explicit zero is a known rate, unlike absence.
- The provider/model/category/currency/date key is unique and nonnull. Same canonical rate is idempotent (`1`, `1.0`, `1.000000`); a conflicting rate throws a generic error and preserves the original. New dates/currencies are separate versions; retrospective dates are allowed.

### Read-only manual quote

```js
const quote = ledger.quoteManual({
  provider: 'synthetic', model: 'fixture', currency: 'USD',
  at: '2026-01-01T00:00:00.000Z',
  usage: { input: 1, output: 0, cacheRead: null, cacheWrite: 0 },
});
```

All five top-level keys are required; no extras or defaults. Identity/currency rules match the catalogue; `at` uses the same canonical real UTC format. `usage` is an object with only the four core category keys, each a nonnegative safe integer or null. Omitted/null counters are unknown, never zero; aggregates, subsets, symbol keys and other types are rejected.

The result copies `provider`, `model`, `currency`, `at`, with `provenance: 'manual-quote'`. `categories` has exactly four results, each `{ tokens, price, amount }`: `price` is the full selected canonical catalogue record or null. For an input rate of `0.000001`, the example's input result has `tokens: 1` and `amount: '0.000000000001'`. Amounts and `total` are exact fixed-12 decimal strings, calculated with BigInt, not floating-point money.

Each category independently selects the latest `effectiveFrom <= at` in one bound SELECT. `coverage` contains `complete`, `missingCounters` and `missingPrices` (category-name arrays). An amount is null if either counter or price is unknown, even if the other is zero. `total` is null unless all four categories are covered; fully priced explicit zero counters produce `'0.000000000000'`. No partial subtotal or currency conversion is implied.

**`at` is the tariff-effective instant, not historical catalogue knowledge.** Retrospective additions can change a fresh quote for the same `at`. Previously returned copied rates/keys/amounts remain self-describing and unchanged, but are not durable historical pricing. Quotes perform no writes, are not stored, and do not claim invoice truth or token ownership. Entries, runtime estimates, ranking, accounting and ledger coverage remain unchanged; no CLI integration. Persisted price application creates a new immutable estimate with applied-rate provenance, never overwrites history.

### Durable caller-explicit manual estimates

`ledger.addManualEstimate({ id, provider, model, currency, at, usage })` requires
exactly these six keys; `ledger.manualEstimate({ id })` requires exactly one and
returns the stored snapshot or null. IDs follow the literal provider/model rules.
Quote validation, four-category coverage and fixed-12 BigInt arithmetic apply.
The snapshot adds `id`, `provenance: 'manual-estimate'` and
`usageProvenance: 'caller-explicit'`; full selected price records are stored,
including incomplete results whose total remains null. No timestamp or free-form
metadata is accepted. Returned objects are fresh copies, including nested prices.

A stable request includes all four counters: omission and null are equivalent,
but explicit zero is distinct. Same ID and canonical request returns the original
without querying prices; a different valid request throws a generic conflict and
writes nothing. New IDs snapshot the current catalogue in one SELECT. `at` remains
tariff-effective time, not historical knowledge: retrospective prices affect new
IDs, never saved ones. Re-estimating even an incomplete snapshot requires a new ID.

Initialization adds `manual_estimates` (`id` primary key, request/estimate JSON).
`BEGIN IMMEDIATE` serializes lookup, optional quote and insertion; failures roll
back with generic errors. No entry linkage, CLI, automatic application, ownership
or invoice claim; accounting, runtime estimates, ranking and import history are
unchanged. Synthetic tests exercise independent handles sequentially, not a
simultaneous cross-process estimate race. Delivered in PR #6 (main `68a85dc`,
commit `1a05948`); historical verification/review evidence is in the roadmap.

### Read-only imported-entry quote (API only)

`ledger.quoteImported({ session, entry, currency })` accepts exactly three own
keys (no symbols/extras). Session/entry are exact importer-compatible nonempty
strings up to 512 characters, without trimming or aliases; currency is three
uppercase ASCII letters. Caller usage, provider, model, date and certainty are
never accepted. Invalid requests fail before SQL: `Invalid imported quote`.

The result includes the request, `provenance: 'imported-entry-quote'`,
`usageProvenance: 'imported-entry'`, `eligibility: { eligible, reasons }`,
`observation` and `quote`. Missing entries have null observation/quote.
Observation contains current operation/certainty, provider/model, outer timestamp
and only the four core usage counters; it is not purported winning evidence.
Only current `own` classification, valid literal catalogue identities, canonical
real UTC outer timestamp and four safe nonnegative counters permit a quote.
Reasons are ordered: `entry-not-found`, or `not-own`, `invalid-provider`,
`invalid-model`, `invalid-timestamp`, `invalid-counters` as applicable.
No header/message timestamp fallback, implicit now or timezone guessing occurs.

Classification and the existing manual quote share one deferred read transaction.
Missing tariffs leave ownership eligible but the quote's total null; zero remains
known. Operational/cleanup failures become `Imported quote operation failed`.
Fresh calls reflect late lineage/conflicts and retrospective tariffs. No invoice
claim, historical rewrite, runtime/ranking change or CLI integration; returned
objects are detached. Delivered in PR #7 (main
`23ab4bc`, commit `8cdcbe9`); historical review evidence is in the roadmap.

### Durable imported-entry estimates (API only)

`ledger.addImportedEstimate({ id, session, entry, currency })` requires exactly
four keys; `ledger.importedEstimate({ id })` returns the saved snapshot or null.
IDs use manual-estimate literal rules; session/entry use imported-quote rules.
Invalid requests fail before SQL with `Invalid imported estimate`.

Creation stores the actual imported quote shape, with `id` and
`provenance: 'imported-entry-estimate'`, `usageProvenance: 'imported-entry'`,
copied observation, creation-time eligibility and full applied-price quote.
Ineligible new IDs throw `Imported estimate ineligible` without persistence;
eligible entries with missing tariffs persist an incomplete quote (null total).

The additive `imported_estimates` table has its own ID namespace. `BEGIN IMMEDIATE`
serializes lookup, classification, pricing and insertion. Canonical retries return
original snapshots **before** reclassification/pricing, including after conflicts
or retrospective tariffs; changed requests throw `Imported estimate conflict`.
Operational failures roll back with `Imported estimate operation failed`.
New IDs use current evidence/catalogue. Alternative estimates are non-additive,
not new consumption, invoice truth or runtime/ranking changes. No CLI integration.

### Checked single imported-estimate reader

`importedEstimate({ id })` still accepts exactly one literal ID, returns a detached
historical snapshot or null, and rejects invalid requests before SQL. Its one
bound SELECT now checks required stored structure, matching ID, provenance,
creation-time eligibility/observation and quote identity/currency/date coherence.
It does not reclassify entries, consult tariffs, repair data or write storage.

Four category counters/prices/amounts and ordered missing-coverage arrays must
agree. Canonical nonnegative fixed-12 money is parsed with BigInt; category
amounts must equal saved rate × counter. Complete quotes require the exact sum;
incomplete quotes require null total, never a partial subtotal. Explicit zero,
large exact amounts and historical snapshots whose entries are now ineligible
remain valid. Unknown extra JSON metadata is preserved, not rejected or coerced.
Malformed JSON, invalid required structure/money or reader failures produce only
`Imported estimate operation failed`; no partial object or private error escapes.

This hardening applies **only to the single-ID reader**. Global enumeration and
idempotent creation retries retain their existing decoding behavior. Arbitrary
`ledger.db` SQL remains outside these guarantees. Selected-cost summary is a
separate API below. Checked-reader hardening was delivered in PR #11 (main
`4213aa4`, commit `b68a20c1621f`); its verification/review are historical.

### Selected imported-estimate cost summary (API only)

`ledger.summarizeImportedEstimates({ ids, currency })` requires exactly two own
keys: a dense array of distinct literal manual-estimate IDs and three uppercase
ASCII currency letters. No extras, symbols, normalization or currency conversion.
Malformed requests/repeated IDs fail before SQL. Missing IDs, wrong currency or
different IDs for the same literal session/entry pair reject the whole selection
with `Invalid imported estimate summary`; alternatives are never chosen or added.

One bound SELECT reads only selected snapshots, ordered by SQLite binary ID order.
Stored snapshots use the checked reader's validation; corrupt selected data or
read failures yield `Imported estimate summary operation failed`, without partial
results or private errors. Unselected corruption does not block the call.
The detached result contains `provenance: 'selected-imported-estimate-summary'`,
`currency`, sorted `ids`, `total` and `coverage: { complete, selected,
completeQuotes, incomplete }`. Each incomplete item has `id`, `missingCounters`
and `missingPrices`. Total is an exact fixed-12 BigInt-derived string only when
all selected quotes are complete; explicit zero is `'0.000000000000'`. Empty or
incomplete selections return null, never a partial subtotal; empty coverage has
false/0/0/[] respectively. No writes, live entry/tariff reads or reclassification.
This is selected historical pricing, not global consumption, current ownership,
invoice truth or cost ranking. Manual/runtime costs and CLI/UI remain separate.

### Global imported-estimate history (API only)

```js
const history = ledger.importedEstimates({});
// { additive: false, estimates: [/* unchanged stored snapshots */] }
```

The argument must be an object with exactly zero own keys: missing arguments,
null, arrays, extra keys (including symbols/non-enumerable keys) are rejected
before SQL with `Invalid imported estimates`. Empty storage returns `estimates: []`.
One SELECT reads all `imported_estimates`, ordered by literal ID with SQLite
`COLLATE BINARY` (case-sensitive), without joins, entry/catalogue reads or writes.
Invalid stored JSON or reader failures reject the whole call with
`Imported estimates operation failed`; no partial results or private errors escape.

Each call deeply decodes detached snapshots, preserving creation-time observation,
eligibility and `quote.coverage` despite later conflicts or tariff changes. This
is historical enumeration, not current ownership or coverage of all imported
entries. Multiple IDs for one entry and multiple currencies are alternatives,
**not additive**: no preferred estimate, repricing, currency conversion or grand
total. Manual estimates remain separate. The result is unbounded/in-memory,
without pagination; no runtime, ranking, UI or CLI integration.

Append-only applies to these public catalogue/estimate methods, not a security guarantee: `ledger.db` still exposes arbitrary SQL. Initialization adds tables transactionally to existing SQLite databases without changing schema versions or deleting data.

## Privacy and boundaries

Only whitelisted accounting/attribution metadata, opaque path keys and keyed copy fingerprints are persisted. No raw prompts, responses, summaries, tool arguments/results, task threads, credentials or source paths. Identifiers and caller-provided labels are metadata: do not put secrets in them. Fingerprints are derived evidence, not transcript exports; protect the database and sidecars as private local data.

SQLite uses WAL, a 5-second busy timeout, initialization retries, transactions and unique insert keys. Public `entries()`, `ranking()` and `accounting()` each use a deferred read transaction; the import's internal snapshot stays inside its write transaction. Separate API calls/output fields are not one combined snapshot. Tests use synthetic fixtures only and independent concurrent processes with overlapping/disjoint inputs. Tests leave synthetic artifacts under ignored `test/.runtime-*/` directories; these can be removed after verification.

Deferred: broader block 2 coverage and trustworthy child-origin evidence, automatic discovery/live `message_end`, delivery/real-session validation of the dashboard connection, automatic model changes, automatic manual price application, repository/worktree grouping and task-time attribution. Files are read fully into memory; this is not yet a large-history streaming importer. No real-session validation, publication or license selection has occurred.

Block 3 catalogue delivered in PR #4 (merge `a55c043`); read-only quotes delivered in PR #5 (main `b3fd9c5`). Estimates delivered in PR #6 (main `68a85dc`), imported quotes in PR #7 (main `23ab4bc`).

Collector extraction delivered in PR #8 (main `35ef3e4`). Durable imported
estimates delivered in PR #9 (main `8e2c823`, commit
`7ad2dbed8c89f23f563cfa3d15376aaf1e996301`); historical evidence is in the roadmap.
Global enumeration delivered in PR #10 (main `8dcc385`, commit
`5a617299619e`); its review/checks are historical, not authority for this unit.
Current unit adds selected historical cost summaries; writer evidence is in the
roadmap and parent review/delivery remain pending.
Rollback removes only this unit's four-file diff; preserve durable databases,
prior APIs and both ignored deferred fixtures.

Block 2 breakdown rollback: revert only its ledger, audit/CLI tests and accompanying documentation changes; no CLI source change, schema migration or database deletion is needed. Synthetic test artifacts stay under ignored `test/.runtime-*/` directories. Independent verification/review and delivery remain parent-owned.

Earlier rollback units: (1A) ledger and audit/writer regressions; (1B) CLI, CLI tests and package test command; accompanying README/roadmap progress. Preserve earlier ignore/documentation changes. Local databases are separate and never migration/deletion targets.
