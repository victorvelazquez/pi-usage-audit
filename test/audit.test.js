import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  appendFileSync,
} from "node:fs";
import { resolve, join, relative, isAbsolute } from "node:path";
import { fork, spawnSync } from "node:child_process";
import { once } from "node:events";
import { openLedger, defaultDatabasePath } from "../src/ledger.js";

const usage = {
  input: 10,
  output: 4,
  cacheRead: 3,
  cacheWrite: 2,
  totalTokens: 19,
  reasoning: 2,
  cacheWrite1h: 1,
};
const header = (id, extra = {}) => ({
  type: "session",
  version: 3,
  id,
  ...extra,
});
const message = (id, extra = {}) => ({
  type: "message",
  id,
  timestamp: "2026-01-01T00:00:00.000Z",
  message: {
    role: "assistant",
    provider: "synthetic",
    model: "fixture",
    usage,
    content: "PRIVATE_SENTINEL",
    ...extra,
  },
});
function fixture() {
  const dir = mkdtempSync(resolve("test/.runtime-"));
  const db = join(dir, "audit.sqlite");
  const file = (name, rows, tail = "") => {
    const path = join(dir, name);
    writeFileSync(path, rows.map(JSON.stringify).join("\n") + "\n" + tail);
    return path;
  };
  const task = (id, sessionPath, agent = "worker", extra = {}) =>
    file(`${id}.json`, [
      {
        task: { id, sessionPath, agent, prompt: "PRIVATE_SENTINEL", ...extra },
        thread: "PRIVATE_SENTINEL",
      },
    ]);
  return { dir, db, file, task };
}

const manualPrice = {
  provider: "synthetic",
  model: "fixture",
  category: "input",
  currency: "USD",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  ratePerMillion: "1",
};
const manualQuery = {
  provider: "synthetic",
  model: "fixture",
  currency: "USD",
};

const importedRequest = { session: "s", entry: "one", currency: "USD" };
const coreUsage = { input: 10, output: 4, cacheRead: 3, cacheWrite: 2 };
const coreCategories = Object.keys(coreUsage);

test("imported quote derives exact evidence, preserves storage and survives restart", () => {
  const f = fixture();
  let ledger = openLedger(f.db);
  const source = f.file("source.jsonl", [header("s"), message("one")]);
  ledger.importFiles({ sessions: [source] });
  const state = () => [
    ledger.entries(),
    ledger.accounting(),
    ledger.ranking(),
    ledger.coverage(),
    ledger.db.prepare("SELECT * FROM manual_estimates").all(),
  ];
  const before = state();
  const quote = () => ledger.quoteImported(importedRequest);
  const absent = ledger.quoteImported({ ...importedRequest, entry: "missing" });
  assert.deepEqual(absent.eligibility.reasons, ["entry-not-found"]);
  assert.equal(absent.eligibility.eligible, false);
  assert.equal(absent.observation, null);
  assert.equal(absent.quote, null);
  assert.equal(quote().quote.total, null);
  for (const category of coreCategories)
    ledger.addManualPrice({
      ...manualPrice,
      category,
      effectiveFrom: "2025-12-31T00:00:00.000Z",
      ratePerMillion: "0.000001",
    });
  ledger.addManualPrice({
    ...manualPrice,
    effectiveFrom: "2026-01-02T00:00:00.000Z",
    ratePerMillion: "9",
  });
  const changes = ledger.db.prepare("SELECT total_changes() AS n");
  const count = changes.get().n;
  const result = quote();
  assert.equal(changes.get().n, count);
  const expected = ledger.quoteManual({
    ...manualQuery,
    at: manualPrice.effectiveFrom,
    usage: coreUsage,
  });
  assert.deepEqual(result, {
    ...importedRequest,
    provenance: "imported-entry-quote",
    usageProvenance: "imported-entry",
    eligibility: { eligible: true, reasons: [] },
    observation: {
      operation: "assistant",
      certainty: "own",
      provider: "synthetic",
      model: "fixture",
      timestamp: manualPrice.effectiveFrom,
      usage: coreUsage,
    },
    quote: expected,
  });
  assert.equal(result.quote.total, "0.000000000019");
  result.observation.usage.input = 999;
  result.quote.categories.input.price.ratePerMillion = "999";
  ledger.addManualPrice({
    ...manualPrice,
    category: "input",
    ratePerMillion: "0.000009",
  });
  assert.equal(quote().quote.total, "0.000000000099");
  assert.deepEqual(state(), before);
  ledger.close();
  ledger = openLedger(f.db);
  assert.equal(quote().quote.total, "0.000000000099");
  assert.equal(expected.total, "0.000000000019");
  const zeros = Object.fromEntries(coreCategories.map((key) => [key, 0]));
  const zero = message("zero", { usage: { ...zeros, totalTokens: 0 } });
  ledger.importFiles({
    sessions: [f.file("source.jsonl", [header("s"), message("one"), zero])],
  });
  const request = { ...importedRequest, entry: "zero" };
  assert.equal(ledger.quoteImported(request).quote.total, "0.000000000000");
  ledger.close();
});

test("imported strict requests reject before SQL and stored metadata cannot counterfeit eligibility", () => {
  const f = fixture();
  const ledger = openLedger(f.db);
  ledger.importFiles({
    sessions: [f.file("source.jsonl", [header("s"), message("one")])],
  });
  const prepare = ledger.db.prepare.bind(ledger.db);
  const exec = ledger.db.exec.bind(ledger.db);
  ledger.db.exec = () => {
    throw new Error("SQL reached");
  };
  ledger.db.prepare = () => {
    throw new Error("SQL reached");
  };
  const missing = { ...importedRequest };
  delete missing.entry;
  const invalid = [null, [], missing, { ...importedRequest, [Symbol()]: 1 }];
  for (const key of ["usage", "provider", "model", "at", "certainty"])
    invalid.push({ ...importedRequest, [key]: "fake" });
  for (const key of ["session", "entry"])
    for (const value of ["", "x".repeat(513), null, 3])
      invalid.push({ ...importedRequest, [key]: value });
  for (const currency of ["usd", "US", "USD\n", 3])
    invalid.push({ ...importedRequest, currency });
  for (const value of invalid)
    assert.throws(() => ledger.quoteImported(value), {
      message: "Invalid imported quote",
    });
  ledger.db.prepare = prepare;
  ledger.db.exec = exec;
  const spaced = { ...importedRequest, session: " s", entry: " one " };
  assert.equal(ledger.quoteImported(spaced).observation, null);
  const original = ledger.entries()[0];
  const update = (patch) =>
    ledger.db
      .prepare("UPDATE entries SET data=?")
      .run(JSON.stringify({ ...original, ...patch }));
  for (const [patch, reasons] of [
    [{ provider: " synthetic" }, ["invalid-provider"]],
    [{ model: "bad\u0000model" }, ["invalid-model"]],
    [{ timestamp: "2026-02-30T00:00:00.000Z" }, ["invalid-timestamp"]],
    [{ timestamp: "2026-01-01T01:00:00.000+01:00" }, ["invalid-timestamp"]],
    [{ timestamp: null }, ["invalid-timestamp"]],
    [{ input: Number.MAX_SAFE_INTEGER + 1 }, ["invalid-counters"]],
    [{ output: -1 }, ["invalid-counters"]],
    [{ cacheRead: null }, ["invalid-counters"]],
    [{ cacheWrite: 0.5 }, ["invalid-counters"]],
    [
      { provider: null, model: null, timestamp: null, input: null },
      [
        "invalid-provider",
        "invalid-model",
        "invalid-timestamp",
        "invalid-counters",
      ],
    ],
  ]) {
    update(patch);
    const result = ledger.quoteImported(importedRequest);
    assert.deepEqual(result.eligibility, { eligible: false, reasons });
    assert.equal(result.quote, null);
  }
  update({ provider: "other", model: "Other", input: 0 });
  const derived = ledger.quoteImported(importedRequest);
  assert.equal(derived.quote.provider, "other");
  assert.equal(derived.quote.model, "Other");
  assert.equal(derived.quote.categories.input.tokens, 0);
  assert.equal(derived.eligibility.eligible, true);
  update({});
  ledger.db.prepare = () => {
    throw new Error("secret SQL/path payload");
  };
  const failure = { message: "Imported quote operation failed" };
  assert.throws(() => ledger.quoteImported(importedRequest), failure);
  ledger.db.exec = (sql) => {
    const result = exec(sql);
    if (sql === "ROLLBACK") throw new Error("cleanup payload");
    return result;
  };
  assert.throws(() => ledger.quoteImported(importedRequest), failure);
  ledger.db.exec = exec;
  ledger.db.prepare = prepare;
  assert.equal(
    ledger.quoteImported(importedRequest).eligibility.eligible,
    true,
  );
  ledger.db.prepare("UPDATE entries SET data=?").run("{");
  assert.throws(() => ledger.quoteImported(importedRequest), failure);
  update({});
  assert.doesNotThrow(() => ledger.importFiles());
  ledger.importFiles({
    sessions: [f.file("spaced.jsonl", [header(" s"), message(" one ")])],
  });
  assert.equal(ledger.quoteImported(spaced).eligibility.eligible, true);
  ledger.close();
});

test("imported current non-own classification and late lineage never quote winning evidence", () => {
  const f = fixture();
  const ledger = openLedger(f.db);
  const parent = f.file("parent.jsonl", [header("p"), message("one")]);
  const child = f.file("child.jsonl", [
    header("c", { parentSession: parent }),
    message("one"),
  ]);
  const source = f.file("source.jsonl", [
    header("s"),
    message("one"),
    message("nested", { role: "toolResult" }),
    message("partial", { usage: { input: 1 } }),
  ]);
  ledger.importFiles({ sessions: [source, child] });
  const check = (session, entry, certainty) => {
    const result = ledger.quoteImported({ session, entry, currency: "USD" });
    assert.equal(result.observation.certainty, certainty);
    assert.equal(result.eligibility.eligible, false);
    assert.equal(result.eligibility.reasons[0], "not-own");
    assert.equal(result.quote, null);
  };
  check("s", "nested", "nested-unknown");
  check("s", "partial", "incomplete");
  check("c", "one", "lineage-unresolved");
  ledger.importFiles({ sessions: [parent] });
  check("c", "one", "copied");
  const different = f.file("different.jsonl", [
    header("d", { parentSession: parent }),
    message("one", { content: "different" }),
  ]);
  ledger.importFiles({ sessions: [different] });
  check("d", "one", "lineage-conflict");
  assert.equal(
    ledger.quoteImported(importedRequest).eligibility.eligible,
    true,
  );
  f.file("source.jsonl", [header("s"), message("one", { model: "changed" })]);
  ledger.importFiles({ sessions: [source] });
  check("s", "one", "identity-conflict");
  const duplicate = f.file("duplicate.jsonl", [header("p"), message("one")]);
  ledger.importFiles({ sessions: [duplicate] });
  check("p", "one", "session-ambiguous");
  check("c", "one", "session-ambiguous");
  ledger.close();
});

test("imported entry and tariffs share one deferred WAL snapshot during independent commit", () => {
  const f = fixture();
  const ledger = openLedger(f.db);
  const other = openLedger(f.db);
  const source = f.file("source.jsonl", [header("s"), message("one")]);
  ledger.importFiles({ sessions: [source] });
  const prepare = ledger.db.prepare.bind(ledger.db);
  let fired = false;
  ledger.db.prepare = (sql) => {
    const stmt = prepare(sql);
    if (sql === "SELECT * FROM entries" && !fired) {
      const all = stmt.all.bind(stmt);
      stmt.all = (...args) => {
        const rows = all(...args);
        fired = true;
        other.db.exec("BEGIN IMMEDIATE");
        other.db.prepare("UPDATE entries SET conflict=1").run();
        for (const category of coreCategories)
          other.addManualPrice({ ...manualPrice, category });
        other.db.exec("COMMIT");
        return rows;
      };
    }
    return stmt;
  };
  const old = ledger.quoteImported(importedRequest);
  assert.equal(fired, true);
  assert.equal(old.eligibility.eligible, true);
  assert.equal(old.quote.total, null);
  assert.equal(old.quote.coverage.missingPrices.length, 4);
  const next = ledger.quoteImported(importedRequest);
  assert.equal(next.observation.certainty, "identity-conflict");
  assert.equal(ledger.quoteImported(importedRequest).quote, null);
  other.close();
  ledger.close();
});

test("manual catalogue persists versions, literal identities and append-only rates", () => {
  const f = fixture();
  let ledger = openLedger(f.db);
  assert.deepEqual(ledger.manualPrices(manualQuery), []);
  const canonical = { ...manualPrice, ratePerMillion: "1.000000" };
  assert.deepEqual(ledger.addManualPrice(manualPrice), canonical);
  const other = openLedger(f.db);
  for (const ratePerMillion of ["1.0", "1.000000"]) {
    assert.deepEqual(
      other.addManualPrice({ ...manualPrice, ratePerMillion }),
      canonical,
    );
  }
  assert.throws(
    () => other.addManualPrice({ ...manualPrice, ratePerMillion: "2" }),
    { message: "Manual price conflict" },
  );
  other.close();
  for (const extra of [
    { category: "output" },
    { category: "cacheWrite" },
    { category: "cacheRead" },
    { effectiveFrom: "0001-01-01T00:00:00.000Z", ratePerMillion: "0" },
    {
      effectiveFrom: "9999-12-31T23:59:59.999Z",
      ratePerMillion: "999999999999.999999",
    },
    { currency: "EUR" },
    { currency: "ZZZ" },
    { provider: "Synthetic" },
    { model: "Fixture" },
    { provider: "other" },
    { model: "other" },
    { provider: "p".repeat(512), model: "m".repeat(512) },
    { effectiveFrom: "2024-02-29T00:00:00.000Z" },
  ])
    ledger.addManualPrice({ ...manualPrice, ...extra });
  ledger.close();
  ledger = openLedger(f.db);
  const versions = ledger.manualPrices(manualQuery);
  assert.deepEqual(
    versions.map((row) => [row.category, row.effectiveFrom]),
    [
      ["cacheRead", manualPrice.effectiveFrom],
      ["cacheWrite", manualPrice.effectiveFrom],
      ["input", "0001-01-01T00:00:00.000Z"],
      ["input", "2024-02-29T00:00:00.000Z"],
      ["input", manualPrice.effectiveFrom],
      ["input", "9999-12-31T23:59:59.999Z"],
      ["output", manualPrice.effectiveFrom],
    ],
  );
  assert.equal(versions[2].ratePerMillion, "0.000000");
  assert.equal(versions[4].ratePerMillion, "1.000000");
  for (const extra of [
    { currency: "EUR" },
    { currency: "ZZZ" },
    { provider: "Synthetic" },
    { model: "Fixture" },
    { provider: "other" },
    { model: "other" },
  ]) {
    assert.equal(ledger.manualPrices({ ...manualQuery, ...extra }).length, 1);
  }
  assert.deepEqual(
    ledger.manualPrices({ ...manualQuery, currency: "GBP" }),
    [],
  );
  ledger.close();
});

test("manual validation rejects malformed fields without changing storage", () => {
  const ledger = openLedger(fixture().db);
  ledger.addManualPrice(manualPrice);
  const before = ledger.manualPrices(manualQuery);
  const invalid = [
    null,
    [],
    "price",
    1,
    {},
    { ...manualPrice, extra: true },
    { ...manualPrice, ratePerMillionExtra: "1" },
    { ...manualPrice, extraRatePerMillion: "1" },
    { ...manualPrice, [Symbol("extra")]: true },
  ];
  for (const key of Object.keys(manualPrice)) {
    const missing = { ...manualPrice };
    delete missing[key];
    invalid.push(missing, { ...manualPrice, [key]: null });
  }
  const values = {
    provider: [
      0,
      "",
      " p",
      "p ",
      "p".repeat(513),
      "\u0000p",
      "p\u007f",
      "p\u0085",
      "p\u202e",
    ],
    model: [
      "",
      " m",
      "m ",
      "m".repeat(513),
      "m\n",
      "\tm",
      "m\u009f",
      "\u200bm",
    ],
    category: ["totalTokens", "reasoning", "cacheWrite1h", "Input", "input "],
    currency: ["usd", "US", "USDD", " USD", "USD\n", "€UR", 123],
    effectiveFrom: [
      "now",
      "2026-01-01",
      "2026-01-01T00:00:00Z",
      "2026-01-01T00:00:00.000+00:00",
      "2025-02-29T00:00:00.000Z",
      "2026-04-31T00:00:00.000Z",
      "0000-01-01T00:00:00.000Z",
      "10000-01-01T00:00:00.000Z",
      "2026-01-01T24:00:00.000Z",
      "2026-01-01T00:00:60.000Z",
      "2026-01-01T00:00:00.000Z\n",
    ],
    ratePerMillion: [
      1,
      0,
      -1,
      NaN,
      Infinity,
      "-1",
      "+1",
      "01",
      ".1",
      "1.",
      "1e2",
      "1,2",
      " 1",
      "1 ",
      "1\n",
      "1.0000000",
      "1000000000000",
      "",
    ],
  };
  for (const [key, candidates] of Object.entries(values)) {
    for (const value of candidates)
      invalid.push({ ...manualPrice, [key]: value });
  }
  for (const value of invalid) {
    assert.throws(() => ledger.addManualPrice(value), {
      message: "Invalid manual price",
    });
    assert.deepEqual(ledger.manualPrices(manualQuery), before);
  }
  const queries = [null, [], {}, { ...manualQuery, category: "input" }];
  for (const key of Object.keys(manualQuery)) {
    const missing = { ...manualQuery };
    delete missing[key];
    queries.push(missing);
    for (const value of values[key])
      queries.push({ ...manualQuery, [key]: value });
  }
  for (const query of queries) {
    assert.throws(() => ledger.manualPrices(query), {
      message: "Invalid manual price",
    });
  }
  assert.deepEqual(ledger.manualPrices(manualQuery), before);
  const columns = ledger.db.prepare("PRAGMA table_info(manual_prices)").all();
  assert.equal(columns.length, 6);
  assert.ok(
    columns.every((column) => column.notnull === 1 && column.type === "TEXT"),
  );
  assert.deepEqual(
    columns.filter((column) => column.pk).map((column) => column.name),
    ["provider", "model", "category", "currency", "effectiveFrom"],
  );
  ledger.close();
});

test("manual additive initialization preserves pre-catalogue schema and accounting", () => {
  const f = fixture();
  // Exact pre-catalogue DDL; only synthetic entries/import reports are seeded.
  const old = new DatabaseSync(f.db);
  old.exec(`
    CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE sources (path TEXT PRIMARY KEY, session TEXT NOT NULL, parent TEXT);
    CREATE TABLE entries (session TEXT, entry TEXT, data TEXT NOT NULL,
      evidence TEXT NOT NULL, conflict INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(session,entry));
    CREATE TABLE tasks (id TEXT PRIMARY KEY, path TEXT NOT NULL,
      agent TEXT, project TEXT, feature TEXT, parent TEXT);
    CREATE TABLE imports (id INTEGER PRIMARY KEY, report TEXT NOT NULL);
    INSERT INTO imports VALUES (1, '{"syntheticLegacy":true}');
  `);
  old.prepare("INSERT INTO entries VALUES (?,?,?,?,?)").run(
    "legacy",
    "one",
    JSON.stringify({
      ...usage,
      operation: "assistant",
      certainty: "own",
      provider: "synthetic",
      model: "fixture",
      runtimeEstimate: null,
      estimateProvenance: "runtime-estimate",
    }),
    "synthetic",
    0,
  );
  const oldEntries = old.prepare("SELECT * FROM entries").all();
  const oldImports = old.prepare("SELECT * FROM imports").all();
  old.close();
  const ledger = openLedger(f.db);
  assert.deepEqual(
    ledger.db.prepare("SELECT * FROM entries").all(),
    oldEntries,
  );
  assert.deepEqual(
    ledger.db.prepare("SELECT * FROM imports").all(),
    oldImports,
  );
  ledger.importFiles({
    sessions: [
      f.file("priced.jsonl", [
        header("priced"),
        message("missing"),
        message("runtime", { usage: { ...usage, cost: { total: 0.25 } } }),
      ]),
    ],
  });
  const snapshot = () => [
    ledger.entries(),
    ledger.ranking(),
    ledger.accounting(),
    ledger.coverage(),
  ];
  const before = snapshot();
  ledger.addManualPrice(manualPrice);
  ledger.addManualPrice({
    ...manualPrice,
    effectiveFrom: "0001-01-01T00:00:00.000Z",
  });
  ledger.quoteManual({
    ...manualQuery,
    at: manualPrice.effectiveFrom,
    usage: {},
  });
  ledger.addManualEstimate({ id: "legacy-estimate", ...quoteRequest });
  assert.equal(
    ledger.db.prepare("PRAGMA table_info(manual_estimates)").all().length,
    3,
  );
  assert.equal(
    ledger.db.prepare("PRAGMA table_info(imported_estimates)").all().length,
    3,
  );
  assert.deepEqual(snapshot(), before);
  assert.equal(ledger.ranking()[0].runtimeEstimate, 0.25);
  ledger.close();
});

const quoteRequest = {
  ...manualQuery,
  at: manualPrice.effectiveFrom,
  usage: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
};
const quoteCategories = Object.keys(quoteRequest.usage);

test("manual estimates retain snapshots across restart and retrospective prices", () => {
  const f = fixture();
  let ledger = openLedger(f.db);
  for (const category of quoteCategories) {
    ledger.addManualPrice({ ...manualPrice, category });
  }
  const request = { id: "original", ...quoteRequest };
  const original = ledger.addManualEstimate(request);
  assert.equal(original.id, request.id);
  assert.equal(original.provenance, "manual-estimate");
  assert.equal(original.usageProvenance, "caller-explicit");
  assert.equal(original.total, "0.000004000000");
  ledger.addManualPrice({
    ...manualPrice,
    effectiveFrom: "2026-01-15T00:00:00.000Z",
    ratePerMillion: "2",
  });
  const later = {
    id: "later",
    ...quoteRequest,
    at: "2026-02-01T00:00:00.000Z",
  };
  const saved = ledger.addManualEstimate(later);
  ledger.addManualPrice({
    ...manualPrice,
    effectiveFrom: "2026-01-20T00:00:00.000Z",
    ratePerMillion: "9",
  });
  const prepare = ledger.db.prepare.bind(ledger.db);
  ledger.db.prepare = (sql) => {
    assert.doesNotMatch(sql, /manual_prices/);
    return prepare(sql);
  };
  assert.deepEqual(ledger.addManualEstimate(later), saved);
  let priceReads = 0;
  ledger.db.prepare = (sql) => {
    if (/SELECT \* FROM manual_prices/.test(sql)) priceReads++;
    return prepare(sql);
  };
  assert.equal(
    ledger.addManualEstimate({ ...later, id: "fresh" }).total,
    "0.000012000000",
  );
  assert.equal(priceReads, 1);
  ledger.db.prepare = prepare;
  original.categories.input.price.ratePerMillion = "999.000000";
  saved.coverage.missingPrices.push("input");
  const durable = ledger.manualEstimate({ id: "later" });
  ledger.close();
  ledger = openLedger(f.db);
  assert.deepEqual(ledger.manualEstimate({ id: "later" }), durable);
  durable.categories.input.tokens = 99;
  assert.equal(
    ledger.manualEstimate({ id: "later" }).categories.input.tokens,
    1,
  );
  assert.equal(
    ledger.manualEstimate({ id: "original" }).categories.input.price
      .ratePerMillion,
    "1.000000",
  );
  assert.equal(ledger.manualEstimate({ id: "absent" }), null);
  for (const id of ["Original", "i".repeat(512)]) {
    assert.equal(ledger.addManualEstimate({ ...request, id }).id, id);
  }
  ledger.close();
});

test("manual estimates canonicalize unknowns, arbitrate handles and roll back failures", () => {
  const f = fixture();
  const ledger = openLedger(f.db);
  const other = openLedger(f.db);
  const request = { id: "unknown", ...quoteRequest, usage: { input: null } };
  const original = ledger.addManualEstimate(request);
  assert.equal(original.total, null);
  assert.deepEqual(original.coverage.missingCounters, quoteCategories);
  assert.deepEqual(original.coverage.missingPrices, quoteCategories);
  const reordered = {
    usage: {},
    at: request.at,
    currency: "USD",
    model: "fixture",
    provider: "synthetic",
    id: "unknown",
  };
  assert.deepEqual(other.addManualEstimate(reordered), original);
  const stored = ledger.db
    .prepare("SELECT request FROM manual_estimates WHERE id=?")
    .get(request.id);
  assert.deepEqual(JSON.parse(stored.request), {
    ...request,
    usage: Object.fromEntries(quoteCategories.map((key) => [key, null])),
  });
  assert.deepEqual(
    Object.keys(JSON.parse(stored.request)),
    Object.keys(request),
  );
  for (const extra of [
    { usage: { input: 0 } },
    { provider: "other" },
    { model: "other" },
    { currency: "EUR" },
    { at: "2026-02-01T00:00:00.000Z" },
  ]) {
    assert.throws(() => other.addManualEstimate({ ...request, ...extra }), {
      message: "Manual estimate conflict",
    });
  }
  ledger.addManualPrice({ ...manualPrice, ratePerMillion: "0" });
  assert.deepEqual(ledger.addManualEstimate(request), original);
  const zero = other.addManualEstimate({
    ...request,
    id: "zero",
    usage: { input: 0 },
  });
  assert.equal(zero.categories.input.amount, "0.000000000000");
  assert.equal(zero.categories.output.amount, null);
  assert.equal(zero.total, null);
  const prepare = ledger.db.prepare.bind(ledger.db);
  for (const failure of [/manual_prices/, /INSERT INTO manual_estimates/]) {
    ledger.db.prepare = (sql) => {
      if (failure.test(sql)) throw new Error("PRIVATE_SENTINEL");
      return prepare(sql);
    };
    assert.throws(() => ledger.addManualEstimate({ ...request, id: "retry" }), {
      message: "Manual estimate operation failed",
    });
    ledger.db.prepare = prepare;
    assert.equal(ledger.manualEstimate({ id: "retry" }), null);
  }
  assert.equal(ledger.manualEstimate({ id: "retry" }), null);
  assert.equal(
    ledger.addManualEstimate({ ...request, id: "retry" }).id,
    "retry",
  );
  const rows = prepare("SELECT * FROM manual_estimates").all();
  assert.equal(rows.length, 3);
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE_SENTINEL/);
  other.close();
  ledger.close();
});

test("manual estimates reject extra privacy fields and invalid requests before SQL", () => {
  const ledger = openLedger(fixture().db);
  const request = { id: "valid", ...quoteRequest };
  const invalid = [
    null,
    [],
    {},
    { ...request, prompt: "PRIVATE_SENTINEL" },
    { ...request, [Symbol()]: 1 },
  ];
  for (const key of Object.keys(request)) {
    const missing = { ...request };
    delete missing[key];
    invalid.push(missing, { ...request, [key]: null });
  }
  const ids = ["", " id", "id ", "i\u200bd", "i\nd", "i".repeat(513), 1];
  for (const id of ids) invalid.push({ ...request, id });
  for (const extra of [
    { currency: "usd" },
    { at: "now" },
    { usage: { input: -1 } },
    { usage: { input: 1.5 } },
    { usage: { input: Number.MAX_SAFE_INTEGER + 1 } },
    { usage: { content: "PRIVATE_SENTINEL" } },
  ])
    invalid.push({ ...request, ...extra });
  ledger.db.prepare = () => assert.fail("invalid request reached SQL");
  ledger.db.exec = () => assert.fail("invalid request began transaction");
  for (const value of invalid) {
    assert.throws(() => ledger.addManualEstimate(value), {
      message: "Invalid manual estimate",
    });
  }
  for (const value of [
    null,
    {},
    [],
    { id: "valid", extra: true },
    { id: "valid", [Symbol()]: 1 },
    ...ids.map((id) => ({ id })),
  ]) {
    assert.throws(() => ledger.manualEstimate(value), {
      message: "Invalid manual estimate",
    });
  }
  ledger.close();
});

test("manual quote selects independent inclusive versions in one read without writes", () => {
  const f = fixture();
  let ledger = openLedger(f.db);
  for (const category of quoteCategories) {
    ledger.addManualPrice({ ...manualPrice, category });
  }
  const later = {
    ...manualPrice,
    effectiveFrom: "2026-02-01T00:00:00.000Z",
    ratePerMillion: "2",
  };
  ledger.addManualPrice(later);
  ledger.addManualPrice({
    ...later,
    effectiveFrom: "2026-03-01T00:00:00.000Z",
    ratePerMillion: "9",
  });
  const request = { ...quoteRequest, at: later.effectiveFrom };
  const prepare = ledger.db.prepare.bind(ledger.db);
  const changes = () => prepare("SELECT total_changes() AS n").get().n;
  const before = changes();
  const statements = [];
  ledger.db.prepare = (sql) => {
    statements.push(sql);
    return prepare(sql);
  };
  const quote = ledger.quoteManual(request);
  assert.equal(statements.length, 1);
  assert.match(statements[0], /^SELECT/);
  assert.equal(changes(), before);
  ledger.db.prepare = prepare;
  assert.deepEqual(Object.keys(quote), [
    "provider",
    "model",
    "currency",
    "at",
    "provenance",
    "categories",
    "coverage",
    "total",
  ]);
  assert.equal(quote.provenance, "manual-quote");
  assert.deepEqual(Object.keys(quote.categories), quoteCategories);
  assert.deepEqual(quote.categories.input, {
    tokens: 1,
    price: { ...later, ratePerMillion: "2.000000" },
    amount: "0.000002000000",
  });
  assert.equal(
    quote.categories.output.price.effectiveFrom,
    manualPrice.effectiveFrom,
  );
  assert.equal(quote.total, "0.000005000000");
  for (const key of ["provider", "model", "currency"]) {
    const missing = ledger.quoteManual({
      ...request,
      [key]: key === "currency" ? "EUR" : "other",
    });
    assert.deepEqual(missing.coverage.missingPrices, quoteCategories);
    assert.equal(missing.total, null);
  }
  const early = { ...request, at: "0001-01-01T00:00:00.000Z" };
  assert.equal(ledger.quoteManual(early).categories.input.price, null);
  ledger.addManualPrice({
    ...manualPrice,
    effectiveFrom: "2026-01-15T00:00:00.000Z",
    category: "output",
    ratePerMillion: "3",
  });
  assert.equal(ledger.quoteManual(request).total, "0.000007000000");
  assert.equal(quote.categories.output.price.ratePerMillion, "1.000000");
  assert.equal(quote.total, "0.000005000000");
  quote.categories.input.price.ratePerMillion = "999.000000";
  assert.equal(
    ledger.quoteManual(request).categories.input.price.ratePerMillion,
    "2.000000",
  );
  const fresh = ledger.quoteManual(request);
  ledger.close();
  ledger = openLedger(f.db);
  assert.deepEqual(ledger.quoteManual(request), fresh);
  ledger.close();
});

test("manual quote exact arithmetic and unknown versus explicit zero coverage", () => {
  const ledger = openLedger(fixture().db);
  ledger.addManualPrice({ ...manualPrice, ratePerMillion: "0.000001" });
  const partial = ledger.quoteManual({
    ...quoteRequest,
    usage: { input: 1, output: 0, cacheRead: null },
  });
  assert.equal(partial.categories.input.amount, "0.000000000001");
  assert.deepEqual(partial.categories.output, {
    tokens: 0,
    price: null,
    amount: null,
  });
  assert.equal(partial.categories.cacheRead.tokens, null);
  assert.equal(partial.categories.cacheWrite.tokens, null);
  assert.deepEqual(partial.coverage, {
    complete: false,
    missingCounters: ["cacheRead", "cacheWrite"],
    missingPrices: ["output", "cacheRead", "cacheWrite"],
  });
  assert.equal(partial.total, null);
  for (const category of quoteCategories) {
    ledger.addManualPrice({
      ...manualPrice,
      category,
      effectiveFrom: "2026-02-01T00:00:00.000Z",
      ratePerMillion: "999999999999.999999",
    });
  }
  const request = { ...quoteRequest, at: "9999-12-31T23:59:59.999Z" };
  const counters = (tokens) =>
    Object.fromEntries(quoteCategories.map((key) => [key, tokens]));
  const maximum = ledger.quoteManual({
    ...request,
    usage: counters(Number.MAX_SAFE_INTEGER),
  });
  assert.equal(
    maximum.categories.input.amount,
    "9007199254740990990992.800745259009",
  );
  assert.equal(maximum.total, "36028797018963963963971.202981036036");
  const estimate = ledger.addManualEstimate({
    id: "maximum",
    ...request,
    usage: counters(Number.MAX_SAFE_INTEGER),
  });
  assert.deepEqual(estimate.categories, maximum.categories);
  assert.equal(estimate.total, maximum.total);
  assert.deepEqual(maximum.coverage, {
    complete: true,
    missingCounters: [],
    missingPrices: [],
  });
  const zero = ledger.quoteManual({ ...request, usage: counters(0) });
  assert.equal(zero.total, "0.000000000000");
  assert.equal(
    ledger.addManualEstimate({ id: "all-zero", ...request, usage: counters(0) })
      .total,
    zero.total,
  );
  const unknown = ledger.quoteManual({ ...request, usage: {} });
  assert.equal(unknown.categories.input.amount, null);
  ledger.addManualPrice({
    ...manualPrice,
    category: "output",
    ratePerMillion: "0",
  });
  const zeroPrice = ledger.quoteManual({ ...quoteRequest, usage: {} });
  assert.equal(zeroPrice.categories.output.amount, null);
  ledger.close();
});

test("manual quote rejects malformed inputs before SQL", () => {
  const ledger = openLedger(fixture().db);
  const invalid = [
    null,
    [],
    {},
    { ...quoteRequest, extra: true },
    { ...quoteRequest, [Symbol()]: 1 },
  ];
  for (const key of Object.keys(quoteRequest)) {
    const missing = { ...quoteRequest };
    delete missing[key];
    invalid.push(missing);
  }
  const values = {
    provider: ["", " p", "p ", "p\u200b", "p\n", "p".repeat(513), 1],
    model: ["", " m", "m\u009f", "m".repeat(513), null],
    currency: ["usd", "US", "USDD", "USD\n", 123],
    at: [
      "now",
      "0000-01-01T00:00:00.000Z",
      "2025-02-29T00:00:00.000Z",
      "2026-04-31T00:00:00.000Z",
      "2026-01-01T24:00:00.000Z",
      "2026-01-01T00:00:60.000Z",
      "2026-01-01T00:00:00Z",
      "2026-01-01T00:00:00.000+00:00",
    ],
    usage: [
      null,
      [],
      1,
      { totalTokens: 1 },
      { reasoning: 1 },
      { cacheWrite1h: 1 },
      { [Symbol()]: 1 },
    ],
  };
  for (const [key, candidates] of Object.entries(values)) {
    for (const value of candidates)
      invalid.push({ ...quoteRequest, [key]: value });
  }
  for (const key of quoteCategories) {
    for (const value of [
      "1",
      1n,
      -1,
      0.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      undefined,
    ]) {
      invalid.push({ ...quoteRequest, usage: { [key]: value } });
    }
  }
  const prepare = ledger.db.prepare;
  ledger.db.prepare = () => assert.fail("Invalid quote reached SQL");
  for (const value of invalid)
    assert.throws(() => ledger.quoteManual(value), {
      message: "Invalid manual quote",
    });
  ledger.db.prepare = prepare;
  ledger.close();
});

test("durable joins: interleaved projects, parents, runs and continuation", () => {
  const f = fixture();
  const a = f.file("a.jsonl", [header("a"), message("1")]);
  const b = f.file("b.jsonl", [header("b"), message("1")]);
  let ledger = openLedger(f.db);
  ledger.importFiles({ sessions: [b, a] });
  assert.equal(ledger.ranking()[0].agent, "unknown");
  const ta = f.task("ta", a, "worker", {
    project: "alpha",
    parentSessionId: "pa",
  });
  const tb = f.task("tb", b, "worker", {
    project: "beta",
    parentSessionId: "pb",
  });
  ledger.importFiles({ tasks: [tb, ta, ta] });
  assert.equal(ledger.ranking()[0].tokens, 38);
  assert.equal(ledger.ranking()[0].sessions, 2);
  ledger.close();
  ledger = openLedger(f.db);
  assert.equal(ledger.attribution("a").project, "alpha");
  f.file("a.jsonl", [header("a"), message("1"), message("2")]);
  ledger.importFiles({
    sessions: [a, b],
    tasks: [
      f.task("continue", a, "worker", {
        project: "alpha",
        parentSessionId: "pa",
      }),
    ],
  });
  assert.equal(ledger.ranking()[0].tokens, 57);
  assert.equal(ledger.attribution("a").project, "alpha");
  assert.equal(ledger.attribution("b").parent, "pb");
  ledger.importFiles({ tasks: [f.task("conflict", a, "other")] });
  assert.equal(ledger.attribution("a").agent, "unknown");
  assert.equal(ledger.ranking().find((r) => r.agent === "unknown").tokens, 38);
  ledger.close();
  for (const suffix of ["", "-wal"]) {
    try {
      assert.equal(
        readFileSync(f.db + suffix).includes("PRIVATE_SENTINEL"),
        false,
      );
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
});

test("auxiliary usage, subsets, missing estimates and nested tool ambiguity", () => {
  const f = fixture();
  const rows = [
    header("aux"),
    message("a"),
    {
      type: "usage",
      id: "u",
      kind: "future-kind",
      provider: "synthetic",
      model: "auxiliary",
      usage,
    },
    { type: "compaction", id: "c", usage, summary: "PRIVATE_SENTINEL" },
    { type: "branch_summary", id: "b", usage },
    message("t", { role: "toolResult", provider: undefined, model: undefined }),
    message("cost", { usage: { ...usage, cost: { total: 0.25 } } }),
  ];
  const ledger = openLedger(f.db);
  ledger.importFiles({ sessions: [f.file("aux.jsonl", rows)] });
  const rank = ledger.ranking()[0];
  assert.equal(rank.tokens, 95);
  assert.equal(rank.runtimeEstimate, 0.25);
  assert.equal(rank.missingEstimates, 4);
  assert.equal(rank.estimateProvenance, "runtime-estimate");
  assert.equal(
    ledger.entries().find((e) => e.entry === "t").certainty,
    "nested-unknown",
  );
  assert.equal(ledger.entries().find((e) => e.entry === "a").reasoning, 2);
  assert.equal(
    ledger.entries().find((e) => e.entry === "u").kind,
    "future-kind",
  );
  assert.equal(ledger.entries().find((e) => e.entry === "t").provider, null);
  ledger.close();
});

test("recover malformed tails, invalid usage and incomplete coverage without false totals", () => {
  const f = fixture();
  const path = f.file(
    "partial.jsonl",
    [
      header("partial"),
      message("good"),
      message("missing", { usage: undefined }),
      message("bad", { usage: { ...usage, reasoning: 9 } }),
      message("pending", { stopReason: "pending" }),
    ],
    '{"type":',
  );
  let ledger = openLedger(f.db);
  const report = ledger.importFiles({ sessions: [path] });
  assert.equal(report.malformed, 1);
  assert.equal(report.incomplete, 2);
  assert.equal(report.pending, 1);
  assert.equal(ledger.ranking()[0].tokens, 19);
  ledger.close();
  appendFileSync(
    path,
    JSON.stringify(message("recovered")).slice('{"type":'.length),
  );
  ledger = openLedger(f.db);
  ledger.importFiles({ sessions: [path] });
  assert.equal(ledger.ranking()[0].tokens, 38);
  assert.equal(ledger.coverage().length, 2);
  ledger.close();
});

test("lineage resolves known copies while exposing unmatched child usage", () => {
  const f = fixture();
  const original = f.file("original.jsonl", [
    header("original"),
    message("copied"),
  ]);
  const clone = f.file("clone.jsonl", [
    header("clone", { parentSession: original }),
    { ...message("copied"), parentId: "re-chained" },
    message("new"),
  ]);
  const independent = f.file("independent.jsonl", [
    header("independent"),
    message("copied"),
  ]);
  const ledger = openLedger(f.db);
  ledger.importFiles({ sessions: [clone] });
  assert.equal(ledger.ranking().length, 0);
  assert.equal(
    ledger.entries().filter((e) => e.certainty === "lineage-unresolved").length,
    2,
  );
  ledger.importFiles({ sessions: [original, independent] });
  assert.equal(ledger.ranking()[0].tokens, 38);
  assert.equal(
    ledger.entries().filter((e) => e.certainty === "copied").length,
    1,
  );
  const child = f.file("child.jsonl", [
    header("child", { parentSession: original }),
    message("unique"),
  ]);
  ledger.importFiles({ sessions: [child] });
  assert.equal(ledger.ranking()[0].tokens, 38);
  assert.equal(ledger.accounting().uncertain.observed.totalTokens, 38);
  ledger.close();
});

test("changed entry identity is quarantined rather than silently overwritten", () => {
  const f = fixture();
  const path = f.file("conflict.jsonl", [header("s"), message("entry")]);
  const ledger = openLedger(f.db);
  ledger.importFiles({ sessions: [path] });
  f.file("conflict.jsonl", [
    header("s"),
    message("entry", { usage: { ...usage, input: 11, totalTokens: 20 } }),
  ]);
  assert.equal(ledger.importFiles({ sessions: [path] }).conflicts, 1);
  assert.equal(ledger.ranking().length, 0);
  ledger.close();
});

test("concurrent process initialization and inserts are unique across restart", {
  timeout: 20000,
}, async () => {
  const f = fixture();
  const path = f.file("shared.jsonl", [
    header("shared"),
    ...Array.from({ length: 20 }, (_, i) => message(String(i))),
  ]);
  const children = Array.from({ length: 4 }, (_, i) =>
    fork(
      new URL("./writer.js", import.meta.url),
      [
        f.db,
        path,
        f.file(`distinct-${i}.jsonl`, [
          header(`distinct-${i}`),
          message("own"),
        ]),
      ],
      {
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        timeout: 10000,
      },
    ),
  );
  const errors = [];
  for (const child of children)
    child.stderr.on("data", (chunk) => errors.push(String(chunk)));
  const exits = children.map((child) => once(child, "exit"));
  await Promise.all(
    children.map((child, i) =>
      Promise.race([
        once(child, "message"),
        exits[i].then(() => {
          throw new Error("Writer exited before ready");
        }),
      ]),
    ),
  );
  children.forEach((child) => child.send("go"));
  for (const [code] of await Promise.all(exits))
    assert.equal(code, 0, errors.join(""));
  const ledger = openLedger(f.db);
  assert.equal(ledger.entries().length, 24);
  assert.equal(ledger.ranking()[0].tokens, 456);
  assert.equal(
    ledger.db.prepare("PRAGMA journal_mode").get().journal_mode,
    "wal",
  );
  assert.equal(ledger.db.prepare("PRAGMA busy_timeout").get().timeout, 5000);
  ledger.importFiles({ sessions: [path] });
  assert.equal(ledger.ranking()[0].tokens, 456);
  ledger.close();
});

test("unequal actors, cwd fallback, task-first joins and late metadata updates", () => {
  const f = fixture();
  const a = f.file("first.jsonl", [header("first"), message("x")]);
  const b = f.file("second.jsonl", [
    header("second"),
    message("x", {
      usage: { ...usage, input: 20, totalTokens: 29 },
    }),
  ]);
  let ledger = openLedger(f.db);
  ledger.importFiles({
    tasks: [
      f.task("first-task", a, "red", { cwd: "/synthetic/alpha" }),
      f.task("second-task", b, "blue", { cwd: "/synthetic/beta" }),
    ],
  });
  ledger.importFiles({ sessions: [b, a] });
  assert.deepEqual(
    ledger.ranking().map((r) => [r.agent, r.tokens]),
    [
      ["blue", 29],
      ["red", 19],
    ],
  );
  assert.notEqual(
    ledger.attribution("first").project,
    ledger.attribution("second").project,
  );
  ledger.close();
  ledger = openLedger(f.db);
  assert.equal(ledger.attribution("second").agent, "blue");
  ledger.importFiles({
    tasks: [f.task("first-task", a, "red", { project: "explicit" })],
  });
  assert.equal(ledger.attribution("first").project, "explicit");
  const malformed = f.file("null.json", [null]);
  const scalar = f.file("scalar.json", [4]);
  const taskReport = ledger.importFiles({ tasks: [malformed, scalar] });
  assert.equal(taskReport.incomplete, 1);
  assert.equal(taskReport.malformed, 1);
  assert.equal(
    ledger.importFiles({ sessions: [f.file("empty.jsonl", [])] }).incomplete,
    1,
  );
  ledger.close();
});

test("privacy under open WAL and explicit conservative identity ambiguity", () => {
  const f = fixture();
  const parent = f.file("parent.jsonl", [
    header("parent"),
    message("collision"),
  ]);
  const child = f.file("child.jsonl", [
    header("child", { parentSession: parent }),
    message("collision", { content: "PRIVATE_SENTINEL_DIFFERENT" }),
  ]);
  const privateFile = f.file("private.jsonl", [
    header("private", { cwd: "PRIVATE_SENTINEL" }),
    message("args", {
      content: [
        { type: "toolCall", arguments: { credential: "PRIVATE_SENTINEL" } },
      ],
    }),
    message("result", { role: "toolResult", content: "PRIVATE_SENTINEL" }),
    {
      type: "compaction",
      id: "summary",
      usage,
      summary: "PRIVATE_SENTINEL",
      credentials: "PRIVATE_SENTINEL",
    },
  ]);
  const ledger = openLedger(f.db);
  const report = ledger.importFiles({ sessions: [child, parent, privateFile] });
  assert.equal(report.certainties["lineage-conflict"], 1);
  assert.equal(report.certainties["nested-unknown"], 1);
  assert.equal(ledger.entries().find((e) => e.entry === "summary").model, null);
  for (const suffix of ["", "-wal"])
    assert.equal(
      readFileSync(f.db + suffix).includes("PRIVATE_SENTINEL"),
      false,
    );
  const reused = f.file("reused.jsonl", [
    header("parent"),
    message("collision"),
  ]);
  ledger.importFiles({ sessions: [reused] });
  assert.equal(
    ledger.entries().find((e) => e.session === "parent").certainty,
    "session-ambiguous",
  );
  ledger.close();
});

test("incomplete parent history cannot prove a retained child entry is new", () => {
  const f = fixture();
  const parent = f.file(
    "truncated-parent.jsonl",
    [header("truncated-parent")],
    '{"type":',
  );
  const child = f.file("child.jsonl", [
    header("child", { parentSession: parent }),
    message("retained"),
  ]);
  const ledger = openLedger(f.db);
  ledger.importFiles({ sessions: [parent, child] });
  assert.equal(ledger.ranking().length, 0);
  assert.equal(ledger.entries()[0].certainty, "lineage-unresolved");
  f.file("truncated-parent.jsonl", [
    header("truncated-parent"),
    message("retained"),
  ]);
  ledger.importFiles({ sessions: [parent] });
  assert.equal(ledger.ranking()[0].tokens, 19);
  assert.equal(
    ledger.entries().find((e) => e.session === "child").certainty,
    "copied",
  );
  ledger.close();
});

test("token counters require safe nonnegative integers, costs allow decimals", () => {
  const f = fixture();
  const invalid = [
    { input: 0.5, output: 0.5, cacheRead: 0, cacheWrite: 0, totalTokens: 1 },
    { input: 10, output: 4, cacheRead: 0.5, cacheWrite: 0.5, totalTokens: 15 },
    { ...usage, reasoning: 0.5 },
    { ...usage, cacheWrite1h: 0.5 },
    {
      input: Number.MAX_SAFE_INTEGER + 1,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: Number.MAX_SAFE_INTEGER + 1,
    },
  ];
  const ledger = openLedger(f.db);
  ledger.importFiles({
    sessions: [
      f.file("fractional.jsonl", [
        header("fractional"),
        ...invalid.map((u, i) => message(String(i), { usage: u })),
      ]),
    ],
  });
  assert.equal(ledger.ranking().length, 0);
  assert.equal(
    ledger.entries().filter((e) => e.certainty === "incomplete").length,
    invalid.length,
  );
  ledger.close();
});

test("lineage cycles are unresolved even when all entry IDs differ", () => {
  const f = fixture();
  const aPath = join(f.dir, "a.jsonl");
  const bPath = join(f.dir, "b.jsonl");
  const a = f.file("a.jsonl", [
    header("a", { parentSession: bPath }),
    message("a-own"),
  ]);
  const b = f.file("b.jsonl", [
    header("b", { parentSession: aPath }),
    message("b-own"),
  ]);
  const ledger = openLedger(f.db);
  const report = ledger.importFiles({ sessions: [a, b] });
  assert.equal(report.unresolved, 2);
  assert.equal(ledger.ranking().length, 0);
  ledger.close();
});

test("accounting, ranking and entries hold a snapshot across an independent writer commit", () => {
  for (const method of ["ranking", "entries", "accounting"]) {
    const f = fixture();
    const path = f.file("source.jsonl", [header("s"), message("one")]);
    const task = f.task("actor", path, "red");
    const ledger = openLedger(f.db);
    try {
      ledger.importFiles({ sessions: [path], tasks: [task] });
      f.file("source.jsonl", [header("s"), message("one"), message("two")]);
      f.task("actor", path, method === "accounting" ? null : "blue");
      const duplicate = f.file("duplicate.jsonl", [
        header("s"),
        message("one"),
      ]);
      const prepare = ledger.db.prepare.bind(ledger.db);
      let fired = false;
      ledger.db.prepare = (sql) => {
        const stmt = prepare(sql);
        const gate =
          method === "entries"
            ? "SELECT * FROM sources"
            : "SELECT * FROM entries";
        if (sql === gate && !fired) {
          const all = stmt.all.bind(stmt);
          stmt.all = (...args) => {
            const rows = all(...args);
            fired = true;
            const child = spawnSync(
              process.execPath,
              [
                "test/writer.js",
                "--commit",
                f.db,
                method === "entries" ? duplicate : path,
                task,
              ],
              { timeout: 10000, encoding: "utf8" },
            );
            assert.equal(child.status, 0, child.stderr);
            return rows;
          };
        }
        return stmt;
      };
      const result = ledger[method]();
      assert.equal(fired, true);
      if (method === "ranking") {
        assert.deepEqual(
          result.map((r) => [r.agent, r.tokens]),
          [["red", 19]],
        );
        assert.deepEqual(
          ledger.ranking().map((r) => [r.agent, r.tokens]),
          [["blue", 38]],
        );
      } else if (method === "accounting") {
        assert.equal(result.breakdown[0].attributionEvidence, "task-consensus");
        assert.equal(result.breakdown[0].observed.totalTokens, 19);
        const next = ledger.accounting().breakdown;
        assert.equal(next[0].attributionEvidence, "missing-agent");
        assert.equal(next[0].observed.totalTokens, 38);
      } else {
        assert.equal(result[0].certainty, "own");
        assert.equal(ledger.entries()[0].certainty, "session-ambiguous");
      }
      ledger.db.prepare = () => {
        throw new Error("synthetic read failure");
      };
      assert.throws(() => ledger[method](), /synthetic read failure/);
      ledger.db.prepare = prepare;
      assert.doesNotThrow(() => ledger.importFiles());
    } finally {
      ledger.close();
    }
  }
});

test("clean parent growth never proves unmatched child origin across restart", () => {
  const f = fixture();
  const parent = f.file("parent.jsonl", [header("p"), message("old")]);
  let ledger = openLedger(f.db);
  ledger.importFiles({ sessions: [parent] });
  ledger.close();
  appendFileSync(parent, JSON.stringify(message("retained")) + "\n");
  const clone = f.file("clone.jsonl", [
    header("clone", {
      parentSession: parent,
      timestamp: "2026-01-02T00:00:00Z",
    }),
    message("retained"),
  ]);
  const sdk = f.file("sdk.jsonl", [
    header("sdk", { parentSession: parent, timestamp: "2025-12-31T00:00:00Z" }),
    message("genuine"),
  ]);
  ledger = openLedger(f.db);
  try {
    ledger.importFiles({ sessions: [clone, sdk] });
    assert.equal(ledger.ranking()[0].tokens, 19);
    assert.equal(ledger.accounting().uncertain.entries, 2);
    assert.equal(ledger.accounting().uncertain.observed.totalTokens, 38);
    assert.equal(ledger.accounting().uncertain.observed.reasoning, 4);
    ledger.close();
    ledger = openLedger(f.db);
    assert.equal(ledger.accounting().uncertain.entries, 2);
    ledger.importFiles({ sessions: [parent] });
    assert.equal(ledger.ranking()[0].tokens, 38);
    assert.equal(
      ledger.entries().find((r) => r.session === "clone").certainty,
      "copied",
    );
    assert.equal(
      ledger.entries().find((r) => r.session === "sdk").certainty,
      "lineage-unresolved",
    );
    assert.equal(ledger.accounting().uncertain.observed.totalTokens, 19);
  } finally {
    ledger.close();
  }
});

test("accounting separates task evidence without fanout or changing legacy ranking", () => {
  const f = fixture();
  const paths = ["absent", "missing", "conflict", "consensus"].map((id) =>
    f.file(`${id}.jsonl`, [header(id), message("one")]),
  );
  let ledger = openLedger(f.db);
  try {
    ledger.importFiles({ sessions: paths });
    assert.equal(
      ledger.accounting().breakdown[0].attributionEvidence,
      "no-task",
    );
    const tasks = [
      f.task("missing", paths[1], null),
      f.task("red", paths[2], "red"),
      f.task("blue", paths[2], "blue"),
      f.task("null", paths[2], null),
      f.task("first", paths[3]),
      f.task("continuation", paths[3]),
    ];
    ledger.importFiles({ tasks });
    const breakdown = ledger.accounting().breakdown;
    assert.deepEqual(
      breakdown.map((r) => [r.attributionEvidence, r.entries]).sort(),
      [
        ["conflicting-agents", 1],
        ["missing-agent", 1],
        ["no-task", 1],
        ["task-consensus", 1],
      ],
    );
    for (const row of breakdown) {
      assert.equal(row.operation, "assistant");
      assert.equal(row.certainty, "own");
      assert.equal(row.additive, false);
      assert.deepEqual(row.observed, usage);
      assert.ok(Object.values(row.missing).every((n) => n === 0));
    }
    assert.deepEqual(
      ledger.ranking().map((r) => [r.agent, r.tokens]),
      [
        ["unknown", 57],
        ["worker", 19],
      ],
    );
    assert.equal(ledger.attribution("conflict").actor, "unknown");
    ledger.close();
    ledger = openLedger(f.db);
    ledger.importFiles({ sessions: paths, tasks });
    assert.deepEqual(ledger.accounting().breakdown, breakdown);
    ledger.importFiles({ tasks: [f.task("late", paths[0])] });
    assert.equal(
      ledger
        .accounting()
        .breakdown.find((r) => r.attributionEvidence === "task-consensus")
        .entries,
      2,
    );
    ledger.importFiles({
      tasks: [f.task("missing-continuation", paths[3], null)],
    });
    assert.equal(
      ledger
        .accounting()
        .breakdown.find((r) => r.attributionEvidence === "missing-agent")
        .entries,
      2,
    );
  } finally {
    ledger.close();
  }
});

test("accounting preserves operations and null/partial observations without inferred roles", () => {
  const f = fixture();
  const ledger = openLedger(f.db);
  try {
    assert.deepEqual(ledger.accounting().breakdown, []);
    ledger.importFiles({
      sessions: [
        f.file("operations.jsonl", [
          header("operations"),
          message("a"),
          { type: "usage", id: "u", kind: "future-kind", usage },
          { type: "compaction", id: "c", usage },
          { type: "branch_summary", id: "b", usage },
          message("t", { role: "toolResult" }),
          message("empty", { usage: undefined }),
          message("partial", { usage: { input: 7 } }),
        ]),
      ],
    });
    const rows = ledger.accounting().breakdown;
    assert.deepEqual(rows.map((r) => r.operation).sort(), [
      "assistant",
      "assistant",
      "branch_summary",
      "compaction",
      "toolResult",
      "usage",
    ]);
    const partial = rows.find((r) => r.certainty === "incomplete");
    assert.equal(partial.entries, 2);
    assert.equal(partial.observed.input, 7);
    assert.equal(partial.missing.input, 1);
    assert.equal(partial.observed.totalTokens, null);
    assert.equal(partial.missing.totalTokens, 2);
    assert.ok(
      rows.every((r) => r.attributionEvidence === "no-task" && !r.additive),
    );
    assert.equal(
      rows.find((r) => r.operation === "toolResult").certainty,
      "nested-unknown",
    );
    assert.equal(ledger.ranking()[0].tokens, 76);
    assert.equal(ledger.accounting().uncertain.observed.totalTokens, 19);
  } finally {
    ledger.close();
  }
});

test("accounting retains three-level copy uncertainty through late ancestors and restart", () => {
  const f = fixture();
  const root = f.file("root.jsonl", [header("root"), message("retained")]);
  const middle = f.file("middle.jsonl", [
    header("middle", { parentSession: root }),
    message("retained"),
  ]);
  const leaf = f.file("leaf.jsonl", [
    header("leaf", { parentSession: middle }),
    message("retained"),
    message("unmatched"),
  ]);
  let ledger = openLedger(f.db);
  try {
    ledger.importFiles({ sessions: [leaf] });
    assert.equal(
      ledger.accounting().breakdown[0].certainty,
      "lineage-unresolved",
    );
    ledger.close();
    ledger = openLedger(f.db);
    ledger.importFiles({ sessions: [middle, root] });
    const rows = ledger.accounting().breakdown;
    assert.deepEqual(rows.map((r) => [r.certainty, r.entries]).sort(), [
      ["copied", 2],
      ["lineage-unresolved", 1],
      ["own", 1],
    ]);
    assert.equal(ledger.ranking()[0].tokens, 19);
    ledger.close();
    ledger = openLedger(f.db);
    ledger.importFiles({ sessions: [leaf, middle, root] });
    assert.deepEqual(ledger.accounting().breakdown, rows);
  } finally {
    ledger.close();
  }
});

test("accounting includes quarantined identity, session and lineage conflict classes", () => {
  const f = fixture();
  const parent = f.file("p.jsonl", [header("p"), message("one")]);
  const child = f.file("c.jsonl", [
    header("c", { parentSession: parent }),
    message("one", { content: "different" }),
  ]);
  const identity = f.file("i.jsonl", [header("i"), message("one")]);
  const ledger = openLedger(f.db);
  try {
    ledger.importFiles({ sessions: [parent, child, identity] });
    assert.equal(
      ledger
        .accounting()
        .breakdown.find((r) => r.certainty === "lineage-conflict").entries,
      1,
    );
    f.file("i.jsonl", [header("i"), message("one", { content: "changed" })]);
    const duplicate = f.file("duplicate.jsonl", [header("p"), message("one")]);
    ledger.importFiles({ sessions: [identity, duplicate] });
    const rows = ledger.accounting().breakdown;
    assert.deepEqual(rows.map((r) => r.certainty).sort(), [
      "identity-conflict",
      "session-ambiguous",
    ]);
    assert.equal(
      rows.find((r) => r.certainty === "session-ambiguous").entries,
      2,
    );
    assert.equal(ledger.ranking().length, 0);
    // Restore neither identity nor lineage: inspect the earlier persisted report.
    assert.equal(ledger.coverage()[0].certainties["lineage-conflict"], 1);
  } finally {
    ledger.close();
  }
});

test("imported estimates freeze eligibility and copied pricing across retries and restart", () => {
  const f = fixture();
  let ledger = openLedger(f.db);
  const source = f.file("saved.jsonl", [header("s"), message("one")]);
  ledger.importFiles({ sessions: [source] });
  const state = () => [
    ledger.entries(),
    ledger.accounting(),
    ledger.ranking(),
    ledger.coverage(),
  ];
  const before = state();
  const request = { id: "saved", ...importedRequest };
  const incomplete = ledger.addImportedEstimate(request);
  assert.deepEqual(incomplete, {
    id: request.id,
    ...ledger.quoteImported(importedRequest),
    provenance: "imported-entry-estimate",
  });
  assert.equal(incomplete.quote.total, null);
  assert.equal(incomplete.provenance, "imported-entry-estimate");
  assert.equal(incomplete.usageProvenance, "imported-entry");
  ledger.addManualEstimate({
    id: request.id,
    ...manualQuery,
    at: manualPrice.effectiveFrom,
    usage: coreUsage,
  });
  for (const category of coreCategories)
    ledger.addManualPrice({
      ...manualPrice,
      category,
      effectiveFrom: "2025-12-30T00:00:00.000Z",
    });
  const complete = ledger.addImportedEstimate({ ...request, id: "complete" });
  assert.equal(complete.quote.total, "0.000019000000");
  const saved = structuredClone(complete);
  complete.quote.categories.input.price.ratePerMillion = "999";
  complete.eligibility.reasons.push("changed");
  assert.deepEqual(ledger.importedEstimate({ id: "complete" }), saved);
  assert.deepEqual(state(), before);
  ledger.close();
  ledger = openLedger(f.db);
  const original = ledger.db.prepare.bind(ledger.db);
  ledger.db.prepare = (sql) => {
    assert.doesNotMatch(sql, /SELECT.*(?:sources|entries|manual_prices)/s);
    return original(sql);
  };
  assert.deepEqual(
    ledger.addImportedEstimate({
      currency: "USD",
      entry: "one",
      session: "s",
      id: "saved",
    }),
    incomplete,
  );
  assert.throws(
    () => ledger.addImportedEstimate({ ...request, entry: "missing" }),
    /^Error: Imported estimate conflict$/,
  );
  ledger.db.prepare = original;
  assert.equal(ledger.importedEstimate({ id: "absent" }), null);
  for (const category of coreCategories)
    ledger.addManualPrice({
      ...manualPrice,
      category,
      effectiveFrom: "2025-12-31T00:00:00.000Z",
      ratePerMillion: "2",
    });
  assert.deepEqual(
    ledger.addImportedEstimate({ ...request, id: "complete" }),
    saved,
  );
  assert.equal(
    ledger.addImportedEstimate({ ...request, id: "later" }).quote.total,
    "0.000038000000",
  );
  appendFileSync(
    source,
    JSON.stringify(
      message("one", { usage: { ...usage, input: 11, totalTokens: 20 } }),
    ) + "\n",
  );
  ledger.importFiles({ sessions: [source] });
  assert.equal(
    ledger.quoteImported(importedRequest).eligibility.eligible,
    false,
  );
  assert.deepEqual(ledger.addImportedEstimate(request), incomplete);
  assert.throws(
    () => ledger.addImportedEstimate({ ...request, id: "rejected" }),
    /^Error: Imported estimate ineligible$/,
  );
  assert.equal(ledger.importedEstimate({ id: "rejected" }), null);
  ledger.close();
});

test("imported estimates enumeration returns detached historical alternatives in binary ID order", () => {
  const f = fixture();
  let ledger = openLedger(f.db);
  try {
    assert.deepEqual(ledger.importedEstimates({}), {
      additive: false,
      estimates: [],
    });
    const source = f.file("enumerated.jsonl", [
      header("s"),
      message("one"),
      message("not-estimated"),
    ]);
    ledger.importFiles({ sessions: [source] });
    const save = (id, currency = "USD") =>
      ledger.addImportedEstimate({ id, ...importedRequest, currency });
    const incomplete = save("a");
    for (const currency of ["USD", "EUR"])
      for (const category of coreCategories)
        ledger.addManualPrice({
          ...manualPrice,
          category,
          currency,
          effectiveFrom: "2025-12-30T00:00:00.000Z",
        });
    const complete = save("Z");
    const euro = save("A", "EUR");
    assert.equal(incomplete.quote.coverage.complete, false);
    assert.equal(complete.quote.coverage.complete, true);
    assert.equal(euro.quote.currency, "EUR");
    ledger.addManualEstimate({
      id: "manual-only",
      ...manualQuery,
      at: manualPrice.effectiveFrom,
      usage: coreUsage,
    });
    for (const category of coreCategories)
      ledger.addManualPrice({
        ...manualPrice,
        category,
        effectiveFrom: "2025-12-31T00:00:00.000Z",
        ratePerMillion: "2",
      });
    assert.equal(
      ledger.quoteImported(importedRequest).quote.total,
      "0.000038000000",
    );
    appendFileSync(
      source,
      JSON.stringify(message("one", { content: "changed" })) + "\n",
    );
    ledger.importFiles({ sessions: [source] });
    assert.equal(
      ledger.quoteImported(importedRequest).eligibility.eligible,
      false,
    );
    const expected = {
      additive: false,
      estimates: [euro, complete, incomplete],
    };
    assert.deepEqual(ledger.importedEstimates({}), expected);
    ledger.close();
    ledger = openLedger(f.db);
    const detached = ledger.importedEstimates({});
    detached.estimates[0].quote.categories.input.price.ratePerMillion = "999";
    detached.estimates[1].eligibility.reasons.push("changed");
    detached.estimates[2].quote.coverage.missingPrices.length = 0;
    detached.estimates[0].observation.certainty = "changed";
    assert.deepEqual(ledger.importedEstimates({}), expected);
    assert.deepEqual(ledger.importedEstimate({ id: "A" }), euro);
  } finally {
    ledger.close();
  }
});

test("imported estimates enumeration strictly validates before SQL and fails atomically", () => {
  const f = fixture();
  const ledger = openLedger(f.db);
  const prepare = ledger.db.prepare.bind(ledger.db);
  const exec = ledger.db.exec.bind(ledger.db);
  try {
    ledger.db.prepare = ledger.db.exec = () =>
      assert.fail("SQL before validation");
    for (const invalid of [
      undefined,
      null,
      [],
      "",
      0,
      () => {},
      { id: "a" },
      { [Symbol()]: 1 },
      Object.defineProperty({}, "hidden", { value: 1 }),
    ])
      assert.throws(
        () => ledger.importedEstimates(invalid),
        /^Error: Invalid imported estimates$/,
      );
    assert.throws(
      () => ledger.importedEstimates(),
      /^Error: Invalid imported estimates$/,
    );
    for (const failure of ["prepare", "select"]) {
      ledger.db.prepare = () => {
        if (failure === "prepare") throw new Error("PRIVATE_SENTINEL");
        return {
          all: () => {
            throw new Error("PRIVATE_SENTINEL");
          },
        };
      };
      assert.throws(
        () => ledger.importedEstimates({}),
        /^Error: Imported estimates operation failed$/,
      );
    }
    ledger.db.prepare = prepare;
    ledger.db.exec = exec;
    ledger.importFiles({
      sessions: [f.file("enumerated.jsonl", [header("s"), message("one")])],
    });
    for (const id of ["A", "Z"])
      ledger.addImportedEstimate({ id, ...importedRequest });
    ledger.db
      .prepare("UPDATE imported_estimates SET estimate=? WHERE id=?")
      .run("PRIVATE_SENTINEL", "Z");
    assert.throws(
      () => ledger.importedEstimates({}),
      /^Error: Imported estimates operation failed$/,
    );
    assert.equal(ledger.importedEstimate({ id: "A" }).id, "A");
  } finally {
    ledger.db.prepare = prepare;
    ledger.db.exec = exec;
    ledger.close();
  }
});

test("imported estimates enumeration uses one read without accounting or storage mutation", () => {
  const f = fixture();
  const ledger = openLedger(f.db);
  const prepare = ledger.db.prepare.bind(ledger.db);
  const exec = ledger.db.exec.bind(ledger.db);
  try {
    ledger.importFiles({
      sessions: [f.file("enumerated.jsonl", [header("s"), message("one")])],
    });
    const saved = ledger.addImportedEstimate({ id: "one", ...importedRequest });
    const state = () => [
      ledger.entries(),
      ledger.accounting(),
      ledger.ranking(),
      ledger.coverage(),
    ];
    const storage = () =>
      [
        "config",
        "sources",
        "entries",
        "tasks",
        "imports",
        "manual_prices",
        "manual_estimates",
        "imported_estimates",
      ].map((table) => prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const hash = (rows) =>
      createHash("sha256").update(JSON.stringify(rows)).digest("hex");
    const before = state();
    const stored = storage();
    const sqls = [];
    ledger.db.prepare = (sql) => {
      sqls.push(sql);
      assert.equal(
        sql,
        "SELECT estimate FROM imported_estimates ORDER BY id COLLATE BINARY",
      );
      return prepare(sql);
    };
    ledger.db.exec = () =>
      assert.fail("enumeration must not write or transact");
    assert.deepEqual(ledger.importedEstimates({}), {
      additive: false,
      estimates: [saved],
    });
    assert.equal(sqls.length, 1);
    ledger.db.prepare = prepare;
    ledger.db.exec = exec;
    assert.deepEqual(state(), before);
    assert.deepEqual(storage(), stored);
    assert.equal(hash(storage()), hash(stored));
  } finally {
    ledger.db.prepare = prepare;
    ledger.db.exec = exec;
    ledger.close();
  }
});

test("imported estimates validate before SQL and retain exact importer identifiers", () => {
  const f = fixture();
  const ledger = openLedger(f.db);
  const request = { id: "valid", ...importedRequest };
  const original = ledger.db.prepare.bind(ledger.db);
  const exec = ledger.db.exec.bind(ledger.db);
  ledger.db.prepare = ledger.db.exec = () =>
    assert.fail("SQL before validation");
  for (const invalid of [
    null,
    [],
    {},
    { ...request, extra: 1 },
    { ...request, [Symbol()]: 1 },
    { ...request, id: " bad" },
    { ...request, id: "x\n" },
    { ...request, session: "" },
    { ...request, entry: "x".repeat(513) },
    { ...request, currency: "usd" },
    { ...request, at: manualPrice.effectiveFrom },
    { ...request, usage: coreUsage },
  ])
    assert.throws(
      () => ledger.addImportedEstimate(invalid),
      /^Error: Invalid imported estimate$/,
    );
  for (const invalid of [
    {},
    { id: " valid" },
    { id: "valid", extra: 1 },
    { id: "valid", [Symbol()]: 1 },
  ])
    assert.throws(
      () => ledger.importedEstimate(invalid),
      /^Error: Invalid imported estimate$/,
    );
  ledger.db.prepare = () => {
    throw new Error("PRIVATE_SENTINEL");
  };
  assert.throws(
    () => ledger.importedEstimate({ id: request.id }),
    /^Error: Imported estimate operation failed$/,
  );
  ledger.db.prepare = original;
  ledger.db.exec = exec;
  ledger.importFiles({
    sessions: [f.file("literal.jsonl", [header(" s "), message(" one ")])],
  });
  assert.equal(
    ledger.addImportedEstimate({ ...request, session: " s ", entry: " one " })
      .observation.certainty,
    "own",
  );
  ledger.close();
});

test("imported estimates rollback failures and serialize independent writer attempts", () => {
  const f = fixture();
  const ledger = openLedger(f.db);
  ledger.importFiles({
    sessions: [f.file("source.jsonl", [header("s"), message("one")])],
  });
  const other = openLedger(f.db);
  other.db.exec("PRAGMA busy_timeout=0");
  const prepare = ledger.db.prepare.bind(ledger.db);
  const exec = ledger.db.exec.bind(ledger.db);
  const request = { id: "atomic", ...importedRequest };
  for (const failure of ["collector", "tariff", "insert", "commit"]) {
    ledger.db.prepare = (sql) => {
      if (
        (failure === "collector" && sql.includes("FROM sources")) ||
        (failure === "tariff" && sql.includes("FROM manual_prices")) ||
        (failure === "insert" &&
          sql.startsWith("INSERT INTO imported_estimates"))
      )
        throw new Error("PRIVATE_SENTINEL");
      return prepare(sql);
    };
    ledger.db.exec = (sql) => {
      if (failure === "commit" && sql === "COMMIT")
        throw new Error("PRIVATE_SENTINEL");
      return exec(sql);
    };
    assert.throws(
      () => ledger.addImportedEstimate(request),
      /^Error: Imported estimate operation failed$/,
    );
    ledger.db.prepare = prepare;
    ledger.db.exec = exec;
    assert.equal(ledger.importedEstimate({ id: request.id }), null);
  }
  const attempts = [];
  ledger.db.prepare = (sql) => {
    if (
      sql.includes("FROM sources") ||
      sql.startsWith("INSERT INTO imported_estimates")
    ) {
      assert.throws(
        () => other.addManualPrice(manualPrice),
        /^Error: Manual price operation failed$/,
      );
      assert.throws(
        () => other.addImportedEstimate(request),
        /^Error: Imported estimate operation failed$/,
      );
      attempts.push(sql);
    }
    return prepare(sql);
  };
  assert.equal(ledger.addImportedEstimate(request).quote.total, null);
  ledger.db.prepare = prepare;
  assert.equal(attempts.length, 2);
  other.addManualPrice(manualPrice);
  assert.equal(
    ledger.addImportedEstimate(request).quote.categories.input.price,
    null,
  );
  assert.equal(
    ledger.addImportedEstimate({ ...request, id: "after" }).quote.categories
      .input.price.ratePerMillion,
    "1.000000",
  );
  assert.deepEqual(
    other.addImportedEstimate(request),
    ledger.importedEstimate({ id: request.id }),
  );
  assert.throws(
    () => other.addImportedEstimate({ ...request, currency: "EUR" }),
    /^Error: Imported estimate conflict$/,
  );
  other.close();
  ledger.close();
});

test("default database is outside repository", () => {
  const rel = relative(resolve("."), defaultDatabasePath());
  assert.ok(
    isAbsolute(rel) ||
      rel === ".." ||
      rel.startsWith(".." + (process.platform === "win32" ? "\\" : "/")),
  );
});
