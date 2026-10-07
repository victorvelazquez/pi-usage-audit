import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  appendFileSync,
  readdirSync,
} from "node:fs";
import { resolve, join, relative, isAbsolute } from "node:path";
import { fork, spawnSync } from "node:child_process";
import { once } from "node:events";
import { openLedger, defaultDatabasePath } from "../src/ledger.js";
import * as ledgerModule from "../src/ledger.js";

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

test("tokenEvolution strict requests, detached results and recovery", () => {
  const ledger = openLedger(":memory:");
  const exec = ledger.db.exec.bind(ledger.db);
  try {
    assert.equal(typeof ledger.tokenEvolution, "function");
    ledger.db.exec = () => assert.fail("invalid reached SQL");
    for (const value of [
      undefined,
      null,
      [],
      { day: "now" },
      { [Symbol()]: 1 },
      Object.defineProperty({}, "hidden", { value: 1 }),
      ...[
        undefined,
        null,
        1,
        [],
        {},
        "",
        "x".repeat(513),
        "😀".repeat(257),
      ].map((session) => ({ session })),
      { session: "s", extra: 1 },
      { session: "s", [Symbol()]: 1 },
      Object.defineProperty({ session: "s" }, "hidden", { value: 1 }),
    ])
      assert.throws(
        () => ledger.tokenEvolution(value),
        /Invalid token evolution/,
      );
    ledger.db.exec = exec;
    const empty = ledger.tokenEvolution({});
    assert.deepEqual(empty, {
      provenance: "imported-own-token-evolution",
      granularity: "day",
      timezone: "UTC",
      buckets: [],
      undated: {
        entries: 0,
        totalTokens: "0",
        missingTimestampEntries: 0,
        invalidTimestampEntries: 0,
      },
      coverage: {
        includedEntries: 0,
        excludedEntries: 0,
        excludedByCertainty: {},
      },
    });
    assert.deepEqual(
      ledger.tokenEvolution(Object.create({ ignored: true })),
      empty,
    );
    for (const session of ["unknown", " ", "x".repeat(512), "😀".repeat(256)])
      assert.deepEqual(ledger.tokenEvolution({ session }), empty);
    assert.deepEqual(
      ledger.tokenEvolution(
        Object.defineProperty({}, "session", {
          value: "unknown",
        }),
      ),
      empty,
    );
    empty.buckets.push({ day: "fake" });
    assert.deepEqual(ledger.tokenEvolution({}).buckets, []);
    ledger.db.exec = () => {
      throw new Error("PRIVATE_SENTINEL");
    };
    assert.throws(
      () => ledger.tokenEvolution({}),
      /^Error: Token evolution operation failed$/,
    );
    ledger.db.exec = exec;
    assert.deepEqual(ledger.tokenEvolution({}).buckets, []);
  } finally {
    ledger.db.exec = exec;
    ledger.close();
  }
});

test("tokenEvolution session selection preserves literal IDs and full lineage", () => {
  const f = fixture();
  let ledger = openLedger(f.db);
  try {
    const huge = {
      input: Number.MAX_SAFE_INTEGER,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: Number.MAX_SAFE_INTEGER,
    };
    const parent = f.file("parent.jsonl", [
      header(" É😀 "),
      message("a", { usage: huge }),
      message("b", { usage: huge }),
      { ...message("missing"), timestamp: null },
      { ...message("invalid"), timestamp: "2026-01-01" },
      message("incomplete", { usage: {} }),
    ]);
    const child = f.file("child.jsonl", [
      header("child", { parentSession: parent }),
      message("a", { usage: huge }),
      message("new"),
    ]);
    const outside = f.file("other.jsonl", [header("É😀"), message("other")]);
    ledger.importFiles({ sessions: [child, outside] });
    assert.deepEqual(ledger.tokenEvolution({ session: "child" }).coverage, {
      includedEntries: 0,
      excludedEntries: 2,
      excludedByCertainty: { "lineage-unresolved": 2 },
    });
    ledger.importFiles({ sessions: [parent] });
    const rows = ledger.db.prepare("SELECT * FROM entries").all();
    const changes = ledger.db.prepare("SELECT total_changes() AS n").get().n;
    const global = ledger.tokenEvolution({});
    const selected = ledger.tokenEvolution({ session: " É😀 " });
    assert.deepEqual(selected.buckets, [
      { day: "2026-01-01", entries: 2, totalTokens: "18014398509481982" },
    ]);
    assert.deepEqual(selected.undated, {
      entries: 2,
      totalTokens: "38",
      missingTimestampEntries: 1,
      invalidTimestampEntries: 1,
    });
    assert.deepEqual(selected.coverage, {
      includedEntries: 4,
      excludedEntries: 1,
      excludedByCertainty: { incomplete: 1 },
    });
    const copied = ledger.tokenEvolution({ session: "child" });
    assert.deepEqual(copied.buckets, []);
    assert.equal(copied.undated.totalTokens, "0");
    assert.deepEqual(copied.coverage.excludedByCertainty, {
      copied: 1,
      "lineage-unresolved": 1,
    });
    assert.deepEqual(
      ledger.tokenEvolution(Object.create({ session: "child" })),
      global,
    );
    for (const session of ["É😀", " é😀 ", " É😀 ", "unknown"])
      assert.equal(
        ledger.tokenEvolution({ session }).coverage.includedEntries,
        session === "É😀" ? 1 : 0,
      );
    assert.deepEqual(ledger.tokenEvolution({}), global);
    assert.deepEqual(ledger.db.prepare("SELECT * FROM entries").all(), rows);
    assert.equal(
      ledger.db.prepare("SELECT total_changes() AS n").get().n,
      changes,
    );
    selected.buckets[0].totalTokens = "0";
    selected.undated.entries = 999;
    selected.coverage.excludedByCertainty.incomplete = 999;
    ledger.close();
    ledger = openLedger(f.db);
    const fresh = ledger.tokenEvolution({ session: " É😀 " });
    assert.equal(fresh.buckets[0].totalTokens, "18014398509481982");
    assert.equal(fresh.undated.entries, 2);
    assert.equal(fresh.coverage.excludedByCertainty.incomplete, 1);
    const row = rows.find((row) => row.session === "É😀");
    ledger.db
      .prepare("UPDATE entries SET data=? WHERE session=?")
      .run(JSON.stringify({ ...JSON.parse(row.data), input: -1 }), row.session);
    assert.deepEqual(ledger.tokenEvolution({ session: " É😀 " }), fresh);
    assert.throws(
      () => ledger.tokenEvolution({ session: "É😀" }),
      /^Error: Token evolution operation failed$/,
    );
    assert.throws(
      () => ledger.tokenEvolution({}),
      /Token evolution operation failed/,
    );
  } finally {
    ledger.close();
  }
});

test("tokenEvolution selected snapshot and sanitized failure recovery", () => {
  const f = fixture();
  const ledger = openLedger(f.db);
  const other = openLedger(f.db);
  const prepare = ledger.db.prepare.bind(ledger.db);
  const exec = ledger.db.exec.bind(ledger.db);
  try {
    ledger.importFiles({
      sessions: [f.file("s.jsonl", [header("s"), message("a")])],
    });
    const before = ledger.tokenEvolution({});
    let fired = false;
    ledger.db.prepare = (sql) => {
      if (sql === "SELECT * FROM entries" && !fired) {
        fired = true;
        other.db.exec("UPDATE sources SET parent='missing' WHERE session='s'");
        other.db.exec(`UPDATE entries SET data=json_set(data,
          '$.input',20,'$.totalTokens',29,'$.timestamp','2026-02-01T00:00:00.000Z')`);
      }
      return prepare(sql);
    };
    assert.deepEqual(ledger.tokenEvolution({ session: "s" }), before);
    assert.equal(fired, true);
    assert.deepEqual(ledger.tokenEvolution({ session: "s" }).coverage, {
      includedEntries: 0,
      excludedEntries: 1,
      excludedByCertainty: { "lineage-unresolved": 1 },
    });
    other.db.exec("UPDATE sources SET parent=NULL WHERE session='s'");
    const next = ledger.tokenEvolution({ session: "s" });
    assert.deepEqual(next.buckets, [
      { day: "2026-02-01", entries: 1, totalTokens: "29" },
    ]);
    for (const failure of ["read", "commit", "rollback"]) {
      ledger.db.prepare = (sql) => {
        if (failure !== "commit") throw new Error("PRIVATE_SENTINEL");
        return prepare(sql);
      };
      ledger.db.exec = (sql) => {
        if (sql === "COMMIT") throw new Error("PRIVATE_SENTINEL");
        const result = exec(sql);
        if (sql === "ROLLBACK" && failure === "rollback")
          throw new Error("PRIVATE_SENTINEL");
        return result;
      };
      assert.throws(
        () => ledger.tokenEvolution({ session: "s" }),
        /^Error: Token evolution operation failed$/,
      );
      ledger.db.prepare = prepare;
      ledger.db.exec = exec;
      assert.equal(ledger.db.isTransaction, false);
      assert.deepEqual(ledger.tokenEvolution({ session: "s" }), next);
    }
  } finally {
    ledger.db.prepare = prepare;
    ledger.db.exec = exec;
    other.close();
    ledger.close();
  }
});

test("tokenEvolution UTC dates, exact totals, ownership and restart conservation", () => {
  const f = fixture();
  let ledger = openLedger(f.db);
  try {
    const huge = {
      input: Number.MAX_SAFE_INTEGER,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: Number.MAX_SAFE_INTEGER,
    };
    const dated = (id, timestamp, tokens = usage) => ({
      ...message(id, { usage: tokens, timestamp: "2020-01-01T00:00:00.000Z" }),
      timestamp,
    });
    const path = f.file("s.jsonl", [
      header("s"),
      dated("later", "2024-03-01T00:00:00.000Z", huge),
      dated("leap", "2024-02-29T23:59:59.999Z", huge),
      dated("zero", "2024-02-28T00:00:00.000Z", {
        ...huge,
        input: 0,
        totalTokens: 0,
      }),
      dated("early", "0001-01-01T00:00:00.000Z"),
      dated("last", "9999-12-31T23:59:59.999Z"),
      dated("missing", null),
      dated("absent", undefined),
      ...[
        "2023-02-29T00:00:00.000Z",
        "2024-02-29T00:00:00Z",
        "2024-02-29T01:00:00.000+01:00",
        "0000-01-01T00:00:00.000Z",
        "2024-04-31T00:00:00.000Z",
      ].map((date, i) => dated(`bad-${i}`, date)),
      message("nested", { role: "toolResult" }),
      message("incomplete", { usage: {} }),
    ]);
    const child = f.file("child.jsonl", [
      header("child", { parentSession: path }),
      dated("leap", "2024-02-29T23:59:59.999Z", huge),
      dated("unresolved", null),
      dated("later", "invalid", huge),
    ]);
    ledger.importFiles({ sessions: [child] });
    assert.equal(ledger.tokenEvolution({}).coverage.includedEntries, 0);
    ledger.importFiles({ sessions: [path] });
    const report = ledger.tokenEvolution({});
    assert.deepEqual(report.buckets, [
      { day: "0001-01-01", entries: 1, totalTokens: "19" },
      { day: "2024-02-28", entries: 1, totalTokens: "0" },
      { day: "2024-02-29", entries: 1, totalTokens: "9007199254740991" },
      { day: "2024-03-01", entries: 1, totalTokens: "9007199254740991" },
      { day: "9999-12-31", entries: 1, totalTokens: "19" },
    ]);
    assert.deepEqual(report.undated, {
      entries: 7,
      totalTokens: "133",
      missingTimestampEntries: 2,
      invalidTimestampEntries: 5,
    });
    const scoped = ledger.tokenEvolution({ session: "child" });
    assert.deepEqual(scoped.coverage, {
      includedEntries: 0,
      excludedEntries: 3,
      excludedByCertainty: {
        copied: 1,
        "lineage-unresolved": 1,
        "lineage-conflict": 1,
      },
    });
    assert.deepEqual(scoped.buckets, []);
    assert.equal(scoped.undated.totalTokens, "0");
    const runtime = ledger.runtimeReport({});
    assert.deepEqual(report.coverage, runtime.coverage);
    assert.deepEqual(report.coverage.excludedByCertainty, {
      copied: 1,
      "lineage-unresolved": 1,
      "lineage-conflict": 1,
      "nested-unknown": 1,
      incomplete: 1,
    });
    assert.equal(
      report.buckets.reduce((n, row) => n + row.entries, 0) +
        report.undated.entries,
      12,
    );
    assert.equal(
      report.buckets.reduce(
        (n, row) => n + BigInt(row.totalTokens),
        BigInt(report.undated.totalTokens),
      ),
      runtime.agents.reduce((n, row) => n + BigInt(row.totalTokens), 0n),
    );
    ledger.importFiles({
      sessions: [path, child],
      tasks: [f.task("late", path)],
    });
    assert.deepEqual(ledger.tokenEvolution({}), report);
    report.buckets[0].totalTokens = "0";
    report.undated.totalTokens = "0";
    assert.equal(ledger.tokenEvolution({}).buckets[0].totalTokens, "19");
    ledger.close();
    ledger = openLedger(f.db);
    assert.equal(ledger.tokenEvolution({}).buckets[0].totalTokens, "19");
    assert.equal(ledger.tokenEvolution({}).undated.totalTokens, "133");
    const original = ledger.db
      .prepare("SELECT data FROM entries WHERE entry='missing'")
      .get().data;
    for (const patch of [
      { totalTokens: 20 },
      { input: -1 },
      { output: null },
    ]) {
      ledger.db
        .prepare("UPDATE entries SET data=? WHERE entry='missing'")
        .run(JSON.stringify({ ...JSON.parse(original), ...patch }));
      assert.throws(
        () => ledger.tokenEvolution({}),
        /^Error: Token evolution operation failed$/,
      );
    }
    ledger.db
      .prepare("UPDATE entries SET data=? WHERE entry='missing'")
      .run(original);
    assert.equal(ledger.tokenEvolution({}).undated.totalTokens, "133");
  } finally {
    ledger.close();
  }
});

test("openExistingLedger rejects missing and incompatible storage without creation or repair", () => {
  const f = fixture();
  const open = (path) => ledgerModule.openExistingLedger(path);
  const empty = join(f.dir, "empty.sqlite");
  const corrupt = join(f.dir, "corrupt.sqlite");
  writeFileSync(empty, "");
  writeFileSync(corrupt, "SYNTHETIC_CORRUPT");
  const before = readdirSync(f.dir);
  for (const path of [
    undefined,
    null,
    1,
    "",
    ":memory:",
    "file:test.sqlite?mode=rwc",
    "FILE:test.sqlite",
    join(f.dir, "missing.sqlite"),
    join(f.dir, "missing ü #%25.sqlite"),
    join(f.dir, "absent", "missing.sqlite"),
    f.dir,
    empty,
    corrupt,
  ]) {
    assert.throws(
      () => open(path),
      (error) => {
        assert.equal(error.message, "Existing ledger open failed");
        assert.equal(error.cause, undefined);
        return true;
      },
    );
  }
  assert.deepEqual(readdirSync(f.dir), before);
  assert.equal(readFileSync(empty).length, 0);
  assert.equal(readFileSync(corrupt, "utf8"), "SYNTHETIC_CORRUPT");
  for (const [index, sql] of [
    "DELETE FROM config",
    "UPDATE config SET value='invalid'",
    "DROP TABLE imported_estimates",
    "DROP TABLE tasks; CREATE TABLE tasks (id TEXT PRIMARY KEY)",
  ].entries()) {
    const path = join(f.dir, `incompatible-${index}.sqlite`);
    const writer = openLedger(path);
    writer.db.exec(sql);
    writer.close();
    const bytes = readFileSync(path);
    assert.throws(() => open(path), /^Error: Existing ledger open failed$/);
    assert.deepEqual(readFileSync(path), bytes);
  }
});

test("openExistingLedger encodes paths, preserves storage and persists atomic tariffs", (t) => {
  const f = fixture();
  const names = ["tarifas ü #%25.sqlite"];
  if (process.platform !== "win32") names.push("tarifas?mode=rwc#ü.sqlite");
  for (const name of names) {
    const path = join(f.dir, name);
    const writer = openLedger(path);
    t.diagnostic(
      `Node ${process.versions.node}; SQLite ${writer.db.prepare("SELECT sqlite_version() AS version").get().version}`,
    );
    const session = f.file("s.jsonl", [header("s"), message("a")]);
    writer.importFiles({ sessions: [session], tasks: [f.task("t", session)] });
    writer.db.exec(
      "PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE",
    );
    const state = () => [
      writer.db.prepare("SELECT * FROM config").all(),
      writer.db.prepare("SELECT * FROM entries").all(),
      writer.db.prepare("SELECT * FROM sqlite_schema ORDER BY name").all(),
      writer.db.prepare("PRAGMA journal_mode").get(),
    ];
    const before = state();
    const bytes = readFileSync(path);
    const files = readdirSync(f.dir);
    const proto = DatabaseSync.prototype;
    const prepare = proto.prepare;
    let db;
    proto.prepare = function (sql) {
      db = this;
      return prepare.call(this, sql);
    };
    let api;
    try {
      api = ledgerModule.openExistingLedger(path);
      proto.prepare = prepare;
      assert.deepEqual(Reflect.ownKeys(api).sort(), [
        "addManualPrice",
        "close",
        "manualPrices",
      ]);
      assert.equal(db.isTransaction, false);
      assert.deepEqual(state(), before);
      assert.deepEqual(readFileSync(path), bytes);
      assert.deepEqual(readdirSync(f.dir), files);
      const canonical = { ...manualPrice, ratePerMillion: "1.000000" };
      assert.deepEqual(api.addManualPrice(manualPrice), canonical);
      assert.deepEqual(
        api.addManualPrice({ ...manualPrice, ratePerMillion: "1.0" }),
        canonical,
      );
      assert.throws(
        () => api.addManualPrice({ ...manualPrice, ratePerMillion: "2" }),
        /Manual price conflict/,
      );
      db.prepare = (sql) => {
        const stmt = prepare.call(db, sql);
        if (sql.includes("SELECT * FROM manual_prices")) {
          stmt.get = () => {
            throw new Error("SYNTHETIC_PRIVATE_SQL_PATH");
          };
        }
        return stmt;
      };
      assert.throws(
        () => api.addManualPrice({ ...manualPrice, category: "output" }),
        /^Error: Manual price operation failed$/,
      );
      db.prepare = prepare;
      assert.deepEqual(api.manualPrices(manualQuery), [canonical]);
      assert.deepEqual(state(), before);
      api.close();
      api = ledgerModule.openExistingLedger(relative(".", path));
      assert.deepEqual(api.manualPrices(manualQuery), [canonical]);
      api.close();
      api = null;
      const reader = ledgerModule.openReadonlyLedger(path);
      try {
        assert.deepEqual(Reflect.ownKeys(reader).sort(), [
          "close",
          "dashboardReport",
        ]);
        const costs = reader.dashboardReport({ currency: "USD" }).costs;
        assert.deepEqual(
          costs.groups[0].quotes[0].quote.categories.input.price,
          canonical,
        );
        assert.equal(
          costs.groups[0].quotes[0].quote.categories.input.amount,
          "0.000010000000",
        );
        assert.equal(costs.groups[0].total, null);
      } finally {
        reader.close();
      }
      assert.deepEqual(readdirSync(f.dir), files);
    } finally {
      proto.prepare = prepare;
      api?.close();
      writer.close();
    }
  }
});

test("openExistingLedger sanitizes opening failures and attempts cleanup", () => {
  const f = fixture();
  const writer = openLedger(f.db);
  writer.close();
  const proto = DatabaseSync.prototype;
  const prepare = proto.prepare;
  const exec = proto.exec;
  const close = proto.close;
  for (const phase of ["validation", "commit"]) {
    let db;
    let closed = false;
    proto.prepare = function (sql) {
      db = this;
      if (phase === "validation") throw new Error("SYNTHETIC_PRIVATE_SQL_PATH");
      return prepare.call(this, sql);
    };
    proto.exec = function (sql) {
      db = this;
      assert.match(sql, /^(BEGIN DEFERRED|COMMIT)$/);
      if (sql === "COMMIT") {
        if (phase === "commit") throw new Error("SYNTHETIC_PRIVATE_SQL_PATH");
      }
      return exec.call(this, sql);
    };
    proto.close = function () {
      closed = true;
      close.call(this);
      throw new Error("SYNTHETIC_PRIVATE_CLOSE_PATH");
    };
    try {
      assert.throws(
        () => ledgerModule.openExistingLedger(f.db),
        (error) => {
          assert.equal(error.message, "Existing ledger open failed");
          assert.equal(error.cause, undefined);
          return true;
        },
      );
      assert.equal(closed, true);
      assert.equal(db.isOpen, false);
    } finally {
      proto.prepare = prepare;
      proto.exec = exec;
      proto.close = close;
    }
  }
});

test("readonly dashboard rejects absent and incompatible storage without repair", () => {
  const f = fixture();
  const open = (path) => ledgerModule.openReadonlyLedger(path);
  const missing = join(f.dir, "absent", "audit.sqlite");
  const empty = join(f.dir, "empty.sqlite");
  const corrupt = join(f.dir, "corrupt.sqlite");
  writeFileSync(empty, "");
  writeFileSync(corrupt, "SYNTHETIC_CORRUPT");
  const before = readdirSync(f.dir);
  for (const path of [
    undefined,
    "",
    ":memory:",
    missing,
    f.dir,
    empty,
    corrupt,
  ])
    assert.throws(() => open(path), /^Error: Readonly ledger open failed$/);
  assert.deepEqual(readdirSync(f.dir), before);
  assert.equal(readFileSync(empty).length, 0);
  assert.equal(readFileSync(corrupt, "utf8"), "SYNTHETIC_CORRUPT");
  for (const [index, sql] of [
    "DELETE FROM config",
    "UPDATE config SET value='invalid'",
    "DROP TABLE tasks; CREATE TABLE tasks (id TEXT PRIMARY KEY)",
    "DROP TABLE entries; CREATE TABLE entries (session TEXT, entry TEXT, data TEXT, evidence TEXT, conflict INTEGER)",
  ].entries()) {
    const path = join(f.dir, `incompatible-${index}.sqlite`);
    const writer = openLedger(path);
    try {
      writer.db.exec(sql);
      const bytes = readFileSync(path);
      assert.throws(() => open(path), /^Error: Readonly ledger open failed$/);
      assert.deepEqual(readFileSync(path), bytes);
    } finally {
      writer.close();
    }
  }
});

test("readonly dashboard allowlist, strict validation, preservation and recovery", () => {
  const f = fixture();
  const writer = openLedger(f.db);
  const proto = DatabaseSync.prototype;
  const prepare = proto.prepare;
  const exec = proto.exec;
  let reader;
  try {
    reader = ledgerModule.openReadonlyLedger(f.db);
    const empty = reader.dashboardReport({ currency: "USD" });
    assert.deepEqual(empty.runtime.agents, []);
    assert.deepEqual(empty.costs.groups, []);
    reader.close();
    reader = null;
    const path = f.file("s.jsonl", [header("s"), message("a")]);
    writer.importFiles({ sessions: [path], tasks: [f.task("t", path)] });
    const rows = () =>
      [
        "config",
        "sources",
        "entries",
        "tasks",
        "imports",
        "manual_prices",
        "manual_estimates",
        "imported_estimates",
      ].map((table) => writer.db.prepare(`SELECT * FROM ${table}`).all());
    const before = rows();
    const bytes = readFileSync(f.db);
    const queries = [];
    const transactions = [];
    let readonlyDb;
    let failOpen = true;
    proto.prepare = function (sql) {
      readonlyDb = this;
      if (failOpen) {
        failOpen = false;
        throw new Error("SYNTHETIC_PRIVATE_PATH");
      }
      queries.push(sql);
      assert.match(sql, /^(SELECT|PRAGMA table_info)/);
      return prepare.call(this, sql);
    };
    proto.exec = function (sql) {
      transactions.push(sql);
      assert.match(sql, /^(BEGIN DEFERRED|COMMIT|ROLLBACK)$/);
      return exec.call(this, sql);
    };
    assert.throws(
      () => ledgerModule.openReadonlyLedger(f.db),
      /^Error: Readonly ledger open failed$/,
    );
    assert.equal(readonlyDb.isOpen, false);
    reader = ledgerModule.openReadonlyLedger(f.db);
    assert.deepEqual(Reflect.ownKeys(reader).sort(), [
      "close",
      "dashboardReport",
    ]);
    assert.throws(
      () => exec.call(readonlyDb, "DELETE FROM entries"),
      /readonly/i,
    );
    queries.length = 0;
    transactions.length = 0;
    for (const value of [
      undefined,
      null,
      [],
      {},
      { currency: "usd" },
      { currency: "USD\n" },
      { currency: "USD", extra: 1 },
      { currency: "USD", [Symbol()]: 1 },
      Object.create({ currency: "USD" }),
      Object.defineProperty({ currency: "USD" }, "hidden", { value: 1 }),
    ])
      assert.throws(
        () => reader.dashboardReport(value),
        /Invalid dashboard report/,
      );
    assert.deepEqual(queries, []);
    assert.deepEqual(transactions, []);
    const first = reader.dashboardReport({ currency: "USD" });
    assert.equal(first.runtime.agents[0].totalTokens, "19");
    assert.equal(first.costs.groups[0].total, null);
    assert.deepEqual(transactions, ["BEGIN DEFERRED", "COMMIT"]);
    assert.deepEqual(first.evolution, writer.tokenEvolution({}));
    const hidden = Object.defineProperty({}, "currency", { value: "USD" });
    assert.deepEqual(reader.dashboardReport(hidden), first);
    let sources = 0;
    proto.prepare = function (sql) {
      if (sql === "SELECT * FROM sources" && ++sources === 3) {
        throw new Error("SYNTHETIC_PRIVATE_PATH");
      }
      return prepare.call(this, sql);
    };
    assert.throws(
      () => reader.dashboardReport({ currency: "USD" }),
      /^Error: Dashboard report operation failed$/,
    );
    assert.deepEqual(reader.dashboardReport({ currency: "USD" }), first);
    first.runtime.agents[0].totalTokens = "0";
    assert.equal(
      reader.dashboardReport({ currency: "USD" }).runtime.agents[0].totalTokens,
      "19",
    );
    reader.close();
    assert.throws(
      () => reader.dashboardReport({ currency: "USD" }),
      /^Error: Dashboard report operation failed$/,
    );
    reader = null;
    proto.prepare = prepare;
    proto.exec = exec;
    assert.deepEqual(rows(), before);
    assert.deepEqual(readFileSync(f.db), bytes);
  } finally {
    proto.prepare = prepare;
    proto.exec = exec;
    reader?.close();
    writer.close();
  }
});

test("dashboardReport holds one snapshot across constant-count writer commit between reports", () => {
  const f = fixture();
  const writer = openLedger(f.db);
  const proto = DatabaseSync.prototype;
  const prepare = proto.prepare;
  let reader;
  try {
    const path = f.file("s.jsonl", [header("s"), message("a")]);
    const child = f.file("child.jsonl", [header("child"), message("b")]);
    writer.importFiles({
      sessions: [path, child],
      tasks: [f.task("t", path, "old")],
    });
    for (const category of ["input", "output", "cacheRead", "cacheWrite"])
      writer.addManualPrice({
        provider: "synthetic",
        model: "fixture",
        category,
        currency: "USD",
        effectiveFrom: "2025-01-01T00:00:00.000Z",
        ratePerMillion: "1",
      });
    const counts = () =>
      ["entries", "sources", "tasks", "manual_prices"].map(
        (table) =>
          writer.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,
      );
    const before = counts();
    reader = ledgerModule.openReadonlyLedger(f.db);
    let sources = 0;
    proto.prepare = function (sql) {
      if (
        this !== writer.db &&
        sql === "SELECT * FROM sources" &&
        ++sources === 2
      ) {
        writer.db.exec("BEGIN IMMEDIATE");
        const row = writer.db
          .prepare("SELECT data FROM entries WHERE session='s'")
          .get();
        const data = {
          ...JSON.parse(row.data),
          input: 20,
          totalTokens: 29,
          timestamp: "2026-02-01T00:00:00.000Z",
        };
        writer.db
          .prepare("UPDATE entries SET data=? WHERE session='s'")
          .run(JSON.stringify(data));
        writer.db.exec(`UPDATE tasks SET agent='new';
          UPDATE manual_prices SET ratePerMillion='2.000000';
          UPDATE sources SET parent='missing' WHERE session='child'; COMMIT`);
      }
      return prepare.call(this, sql);
    };
    const first = reader.dashboardReport({ currency: "USD" });
    assert.equal(sources, 3);
    assert.deepEqual(first.evolution.buckets, [
      { day: "2026-01-01", entries: 2, totalTokens: "38" },
    ]);
    assert.deepEqual(first.evolution.coverage, first.runtime.coverage);
    assert.equal(
      first.runtime.agents.find((row) => row.agent === "old").totalTokens,
      "19",
    );
    assert.equal(
      first.costs.groups.find((row) => row.agent === "old").total,
      "0.000019000000",
    );
    assert.equal(first.costs.coverage.includedEntries, 2);
    assert.deepEqual(first.runtime.coverage, first.costs.coverage);
    assert.deepEqual(counts(), before);
    const next = reader.dashboardReport({ currency: "USD" });
    assert.deepEqual(next.evolution.buckets, [
      { day: "2026-02-01", entries: 1, totalTokens: "29" },
    ]);
    assert.deepEqual(next.evolution.coverage, next.runtime.coverage);
    assert.equal(next.runtime.agents[0].agent, "new");
    assert.equal(next.runtime.agents[0].totalTokens, "29");
    assert.equal(next.costs.groups[0].total, "0.000058000000");
    assert.deepEqual(next.runtime.coverage, next.costs.coverage);
    assert.equal(
      next.costs.coverage.excludedByCertainty["lineage-unresolved"],
      1,
    );
  } finally {
    proto.prepare = prepare;
    reader?.close();
    writer.close();
  }
});

test("costReport strict requests, detached empty result and generic recovery", () => {
  const f = fixture();
  const ledger = openLedger(f.db);
  const exec = ledger.db.exec.bind(ledger.db);
  try {
    ledger.db.exec = () => assert.fail("invalid reached SQL");
    for (const value of [
      undefined,
      null,
      [],
      {},
      { currency: "usd" },
      { currency: "USD\n" },
      { currency: "USD", at: "now" },
      { session: "s" },
      ...[
        undefined,
        null,
        1,
        [],
        {},
        "",
        "x".repeat(513),
        "😀".repeat(257),
      ].map((session) => ({ currency: "USD", session })),
      { currency: "USD", session: "s", extra: 1 },
      { currency: "USD", session: "s", [Symbol()]: 1 },
      Object.defineProperty({ currency: "USD", session: "s" }, "hidden", {
        value: 1,
      }),
      { currency: "USD", [Symbol()]: 1 },
      Object.create({ currency: "USD" }),
    ]) {
      assert.throws(() => ledger.costReport(value), /Invalid cost report/);
    }
    ledger.db.exec = exec;
    const empty = ledger.costReport({ currency: "USD" });
    for (const session of ["unknown", " ", "x".repeat(512), "😀".repeat(256)])
      assert.deepEqual(ledger.costReport({ currency: "USD", session }), empty);
    const hidden = Object.defineProperties(
      {},
      { currency: { value: "USD" }, session: { value: "unknown" } },
    );
    assert.deepEqual(ledger.costReport(hidden), empty);
    assert.deepEqual(
      ledger.costReport(
        Object.assign(Object.create({ session: "ignored" }), {
          currency: "USD",
        }),
      ),
      empty,
    );
    assert.deepEqual(empty.groups, []);
    assert.deepEqual(empty.coverage, {
      includedEntries: 0,
      excludedEntries: 0,
      excludedByCertainty: {},
    });
    ledger.db.exec = () => {
      throw new Error("PRIVATE_SENTINEL");
    };
    assert.throws(
      () => ledger.costReport({ currency: "USD", session: "unknown" }),
      /^Error: Cost report operation failed$/,
    );
    ledger.db.exec = exec;
    assert.deepEqual(ledger.costReport({ currency: "USD" }), empty);
  } finally {
    ledger.db.exec = exec;
    ledger.close();
  }
});

test("costReport exact grouped quotes, dates, exclusions and late attribution", () => {
  const f = fixture();
  const ledger = openLedger(f.db);
  try {
    const huge = {
      input: Number.MAX_SAFE_INTEGER,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: Number.MAX_SAFE_INTEGER,
    };
    const path = f.file("s.jsonl", [
      header("s"),
      message("a", { usage: huge }),
      message("b", { usage: huge }),
      message("zero", {
        model: "zero",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
        },
      }),
      message("missing", { model: "missing" }),
      message("bad", { provider: null }),
      { ...message("date"), timestamp: "2026-01-01" },
      message("nested", { role: "toolResult" }),
      message("pending", { stopReason: "pending" }),
    ]);
    const child = f.file("c.jsonl", [
      header("c", { parentSession: path }),
      message("a", { usage: huge }),
      message("new"),
    ]);
    ledger.importFiles({ sessions: [path, child] });
    const price = (
      model,
      category,
      ratePerMillion,
      effectiveFrom = "2026-01-01T00:00:00.000Z",
    ) =>
      ledger.addManualPrice({
        provider: "synthetic",
        model,
        category,
        currency: "USD",
        effectiveFrom,
        ratePerMillion,
      });
    for (const category of ["input", "output", "cacheRead", "cacheWrite"]) {
      price("fixture", category, "999999999999.999999");
      price("fixture", category, "0", "2026-01-02T00:00:00.000Z");
      price("zero", category, "0");
    }
    const before = ledger.db.prepare("SELECT * FROM entries").all();
    const report = ledger.costReport({ currency: "USD" });
    assert.equal(report.provenance, "imported-own-manual-cost-report");
    assert.deepEqual(report.coverage, {
      includedEntries: 6,
      excludedEntries: 3,
      excludedByCertainty: {
        copied: 1,
        "lineage-unresolved": 1,
        "nested-unknown": 1,
      },
    });
    const group = report.groups.find(
      (g) => g.model === "fixture" && g.provider,
    );
    assert.equal(group.entries, 3);
    assert.equal(group.total, null);
    assert.deepEqual(group.coverage, {
      complete: false,
      completeQuotes: 2,
      incompleteEntries: 1,
    });
    assert.equal(
      group.quotes[0].quote.total,
      "9007199254740990990992.800745259009",
    );
    assert.deepEqual(group.quotes[2].eligibility.reasons, [
      "invalid-timestamp",
    ]);
    assert.equal(
      report.groups.find((g) => g.model === "zero").total,
      "0.000000000000",
    );
    const missing = report.groups.find((g) => g.model === "missing");
    assert.equal(missing.total, null);
    assert.equal(missing.quotes[0].quote.coverage.missingPrices.length, 4);
    assert.equal(report.groups[0].provider, null);
    assert.deepEqual(ledger.db.prepare("SELECT * FROM entries").all(), before);
    report.groups[0].quotes[0].observation.usage.input = 999;
    ledger.importFiles({
      tasks: [f.task("t", path, "z"), f.task("continuation", path, "z")],
    });
    assert.equal(ledger.costReport({ currency: "USD" }).groups[0].agent, "z");
    assert.equal(
      ledger
        .costReport({ currency: "EUR" })
        .groups.every((g) => g.total === null),
      true,
    );
    price("missing", "input", "1", "2025-01-01T00:00:00.000Z");
    assert.equal(
      ledger
        .costReport({ currency: "USD" })
        .groups.find((g) => g.model === "missing").quotes[0].quote.categories
        .input.amount,
      "0.000010000000",
    );
    const second = f.file("other.jsonl", [
      header("other"),
      message("a", { usage: huge }),
      message("b", { usage: huge }),
    ]);
    ledger.importFiles({
      sessions: [second],
      tasks: [f.task("other-task", second, "a")],
    });
    const joint = ledger.costReport({ currency: "USD" }).groups;
    assert.equal(joint[0].agent, "a");
    assert.equal(joint[0].entries, 2);
    assert.equal(joint[0].total, "18014398509481981981985.601490518018");
    const selected = ledger.costReport({ currency: "USD", session: "other" });
    assert.deepEqual(selected.groups, [joint[0]]);
    assert.deepEqual(selected.coverage, {
      includedEntries: 2,
      excludedEntries: 0,
      excludedByCertainty: {},
    });
    const own = ledger.costReport({ currency: "USD", session: "s" });
    assert.equal(
      own.groups.find((g) => g.model === "zero").total,
      "0.000000000000",
    );
    assert.equal(
      own.groups.find((g) => g.model === "fixture" && g.provider).total,
      null,
    );
    assert.deepEqual(own.coverage.excludedByCertainty, { "nested-unknown": 1 });
    assert.equal(
      joint.find((g) => g.agent === "z" && g.model === "fixture").total,
      null,
    );
    ledger.db
      .prepare(
        "UPDATE entries SET data=json_set(data,'$.input',null) WHERE entry='zero'",
      )
      .run();
    const invalid = ledger
      .costReport({ currency: "USD" })
      .groups.find((g) => g.model === "zero");
    assert.deepEqual(invalid.quotes[0].eligibility.reasons, [
      "invalid-counters",
    ]);
    assert.equal(invalid.total, null);
  } finally {
    ledger.close();
  }
});

test("costReport session literal selection follows full lineage and stays detached", () => {
  const f = fixture();
  let ledger = openLedger(f.db);
  try {
    const parent = f.file("parent.jsonl", [header("Parent"), message("a")]);
    const child = f.file("child.jsonl", [
      header(" Child ", { parentSession: parent }),
      message("a"),
      message("new"),
    ]);
    const unrelated = f.file("other.jsonl", [header("child"), message("b")]);
    ledger.importFiles({ sessions: [child, unrelated] });
    const request = { currency: "EUR", session: " Child " };
    assert.deepEqual(ledger.costReport(request).coverage, {
      includedEntries: 0,
      excludedEntries: 2,
      excludedByCertainty: { "lineage-unresolved": 2 },
    });
    ledger.importFiles({ sessions: [parent] });
    const rows = () =>
      ["entries", "sources", "tasks", "manual_prices"].map((table) =>
        ledger.db.prepare(`SELECT * FROM ${table}`).all(),
      );
    const before = rows();
    const report = ledger.costReport(request);
    assert.equal(report.currency, "EUR");
    assert.deepEqual(report.groups, []);
    assert.deepEqual(report.coverage, {
      includedEntries: 0,
      excludedEntries: 2,
      excludedByCertainty: { copied: 1, "lineage-unresolved": 1 },
    });
    for (const session of ["Child", " Child", " child "])
      assert.deepEqual(ledger.costReport({ ...request, session }).coverage, {
        includedEntries: 0,
        excludedEntries: 0,
        excludedByCertainty: {},
      });
    const selected = ledger.costReport({ ...request, session: "Parent" });
    assert.equal(selected.groups[0].entries, 1);
    assert.equal(selected.groups[0].total, null);
    assert.equal(selected.groups[0].quotes[0].session, "Parent");
    assert.deepEqual(rows(), before);
    selected.groups[0].quotes[0].observation.usage.input = 999;
    Object.defineProperty(report.coverage.excludedByCertainty, "copied", {
      value: 999,
    });
    assert.equal(
      ledger.costReport(request).coverage.excludedByCertainty.copied,
      1,
    );
    assert.equal(
      ledger.costReport({ ...request, session: "Parent" }).groups[0].quotes[0]
        .observation.usage.input,
      10,
    );
    ledger.close();
    ledger = openLedger(f.db);
    assert.equal(
      ledger.costReport(request).coverage.excludedByCertainty.copied,
      1,
    );
    assert.equal(
      ledger.costReport({ currency: "EUR" }).coverage.includedEntries,
      2,
    );
    const ambiguous = f.file("ambiguous.jsonl", [
      header("child"),
      message("c"),
    ]);
    ledger.importFiles({ sessions: [ambiguous] });
    assert.deepEqual(
      ledger.costReport({ ...request, session: "child" }).coverage,
      {
        includedEntries: 0,
        excludedEntries: 2,
        excludedByCertainty: { "session-ambiguous": 2 },
      },
    );
    const changed = f.file("parent.jsonl", [
      header("Parent"),
      message("a", { usage: { ...usage, input: 11, totalTokens: 20 } }),
    ]);
    ledger.importFiles({ sessions: [changed] });
    assert.deepEqual(
      ledger.costReport({ ...request, session: "Parent" }).coverage,
      {
        includedEntries: 0,
        excludedEntries: 1,
        excludedByCertainty: { "identity-conflict": 1 },
      },
    );
  } finally {
    ledger.close();
  }
});

test("costReport single snapshot includes attribution and tariff selection", () => {
  const f = fixture();
  const path = f.file("s.jsonl", [header("s"), message("a")]);
  const ledger = openLedger(f.db);
  const other = openLedger(f.db);
  const prepare = ledger.db.prepare.bind(ledger.db);
  try {
    ledger.importFiles({ sessions: [path], tasks: [f.task("t", path, "a")] });
    let fired = false;
    ledger.db.prepare = (sql) => {
      const stmt = prepare(sql);
      if (sql === "SELECT * FROM entries" && !fired) {
        const all = stmt.all.bind(stmt);
        stmt.all = () => {
          const rows = all();
          fired = true;
          other.importFiles({ tasks: [f.task("t", path, "b")] });
          for (const category of ["input", "output", "cacheRead", "cacheWrite"])
            other.addManualPrice({
              provider: "synthetic",
              model: "fixture",
              category,
              currency: "USD",
              effectiveFrom: "2025-01-01T00:00:00.000Z",
              ratePerMillion: "1",
            });
          return rows;
        };
      }
      return stmt;
    };
    const first = ledger.costReport({ currency: "USD", session: "s" })
      .groups[0];
    assert.equal(fired, true);
    assert.equal(first.agent, "a");
    assert.equal(first.total, null);
    const next = ledger.costReport({ currency: "USD", session: "s" }).groups[0];
    assert.equal(next.agent, "b");
    assert.equal(next.total, "0.000019000000");
    assert.equal(first.quotes[0].quote.categories.input.price, null);
  } finally {
    ledger.db.prepare = prepare;
    other.close();
    ledger.close();
  }
});

test("runtimeReport strict requests, empty result and generic recovery", () => {
  const f = fixture();
  const ledger = openLedger(f.db);
  const exec = ledger.db.exec.bind(ledger.db);
  try {
    ledger.db.exec = () => assert.fail("invalid reached SQL");
    for (const value of [
      undefined,
      null,
      [],
      { x: 1 },
      { session: "" },
      { session: "x".repeat(513) },
      { session: 1 },
      { session: null },
      { session: "s", extra: true },
      { session: "s", [Symbol()]: 1 },
      Object.defineProperty({ session: "s" }, "x", { value: 1 }),
      { [Symbol()]: 1 },
      Object.defineProperty({}, "x", { value: 1 }),
    ]) {
      assert.throws(
        () => ledger.runtimeReport(value),
        /Invalid runtime report/,
      );
    }
    ledger.db.exec = exec;
    const empty = ledger.runtimeReport({});
    assert.deepEqual(ledger.runtimeReport({ session: "unknown" }), empty);
    assert.deepEqual(ledger.runtimeReport({ session: "x".repeat(512) }), empty);
    assert.deepEqual(
      ledger.runtimeReport(
        Object.defineProperty({}, "session", { value: "s" }),
      ),
      empty,
    );
    assert.deepEqual(empty.agents, []);
    assert.deepEqual(empty.models, []);
    assert.deepEqual(empty.runtime.coverage, {
      recordedEntries: 0,
      missingEntries: 0,
      unknownCurrencyEntries: 0,
    });
    ledger.db.exec = () => {
      throw new Error("PRIVATE_SENTINEL");
    };
    assert.throws(
      () => ledger.runtimeReport({ session: "s" }),
      /^Error: Runtime report operation failed$/,
    );
    ledger.db.exec = exec;
    assert.deepEqual(ledger.runtimeReport({}), empty);
  } finally {
    ledger.db.exec = exec;
    ledger.close();
  }
});

test("runtimeReport exact views, individual amounts, continuation, detach and restart", () => {
  const f = fixture();
  const huge = Number.MAX_SAFE_INTEGER - 3;
  const use = (input, cost) => ({
    input,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input,
    ...(cost === undefined ? {} : { cost: { total: cost } }),
  });
  const a = f.file("a.jsonl", [
    header("a"),
    message("1", { usage: use(huge, 0.123456789) }),
    message("2", { provider: null, model: null, usage: use(huge, 0) }),
    message("3", { provider: "null", model: "null", usage: use(0) }),
  ]);
  const child = f.file("c.jsonl", [
    header("c", { parentSession: a }),
    message("1", { usage: use(huge, 0.123456789) }),
    message("new"),
  ]);
  let ledger = openLedger(f.db);
  try {
    ledger.importFiles({
      sessions: [a, child],
      tasks: [f.task("t", a, "red"), f.task("u", a, "red")],
    });
    const before = ledger.db.prepare("SELECT * FROM entries").all();
    const changes = ledger.db.prepare("SELECT total_changes() AS n").get().n;
    const aggregates = ["ranking", "accounting", "modelUsage"];
    const saved = aggregates.map((method) => ledger[method]);
    for (const method of aggregates) {
      ledger[method] = () => assert.fail("nested public aggregate");
    }
    const result = ledger.runtimeReport({});
    assert.equal(
      ledger.db.prepare("SELECT total_changes() AS n").get().n,
      changes,
    );
    aggregates.forEach((method, i) => {
      ledger[method] = saved[i];
    });
    assert.equal(result.provenance, "imported-own-runtime-report");
    assert.deepEqual(result.models, ledger.modelUsage({}).groups);
    assert.deepEqual(result.coverage, ledger.modelUsage({}).coverage);
    assert.deepEqual(result.agents, [
      {
        agent: "red",
        entries: 3,
        sessions: 1,
        totalTokens: (BigInt(huge) * 2n).toString(),
      },
    ]);
    assert.deepEqual(result.runtime, {
      provenance: "runtime-estimate",
      currency: null,
      total: null,
      totalUnavailableReason: "runtime-currency-not-recorded",
      observations: [
        {
          session: "a",
          entry: "1",
          provider: "synthetic",
          model: "fixture",
          agent: "red",
          amount: 0.123456789,
        },
        {
          session: "a",
          entry: "2",
          provider: null,
          model: null,
          agent: "red",
          amount: 0,
        },
      ],
      coverage: {
        recordedEntries: 2,
        missingEntries: 1,
        unknownCurrencyEntries: 2,
      },
    });
    assert.deepEqual(result.coverage.excludedByCertainty, {
      copied: 1,
      "lineage-unresolved": 1,
    });
    assert.deepEqual(ledger.db.prepare("SELECT * FROM entries").all(), before);
    result.models[0].tokens.input = "0";
    result.runtime.observations[0].amount = 999;
    ledger.close();
    ledger = openLedger(f.db);
    assert.equal(
      ledger.runtimeReport({}).runtime.observations[0].amount,
      0.123456789,
    );
    ledger.importFiles({ tasks: [f.task("u", a, "blue")] });
    assert.equal(ledger.runtimeReport({}).agents[0].agent, "unknown");
    for (const patch of [
      { input: -1 },
      { runtimeEstimate: -1 },
      { runtimeEstimate: "Infinity" },
    ]) {
      const row = before[0];
      const data = { ...JSON.parse(row.data), ...patch };
      ledger.db
        .prepare("UPDATE entries SET data=? WHERE session=? AND entry=?")
        .run(JSON.stringify(data), row.session, row.entry);
      assert.throws(
        () => ledger.runtimeReport({}),
        /Runtime report operation failed/,
      );
      ledger.db
        .prepare("UPDATE entries SET data=? WHERE session=? AND entry=?")
        .run(row.data, row.session, row.entry);
    }
    assert.doesNotThrow(() => ledger.runtimeReport({}));
  } finally {
    ledger.close();
  }
});

test("runtimeReport session scope preserves literal IDs and full lineage", () => {
  const f = fixture();
  const huge = Number.MAX_SAFE_INTEGER - 3;
  const use = (input, amount) => ({
    input,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input,
    ...(amount === undefined ? {} : { cost: { total: amount } }),
  });
  const selected = f.file("selected.jsonl", [
    header(" S "),
    message("one", { usage: use(huge, 0) }),
    message("two", { usage: use(huge) }),
    message("zero", { usage: use(0) }),
  ]);
  const outside = f.file("outside.jsonl", [header("S"), message("other")]);
  const child = f.file("child.jsonl", [
    header("child", { parentSession: selected }),
    message("one", { usage: use(huge, 0) }),
    message("new"),
  ]);
  const ambiguous = ["amb-a.jsonl", "amb-b.jsonl"].map((name) =>
    f.file(name, [header("amb"), message("same")]),
  );
  let ledger = openLedger(f.db);
  try {
    ledger.importFiles({
      sessions: [selected, outside, child, ...ambiguous],
      tasks: [f.task("t", selected, "red"), f.task("u", selected, "red")],
    });
    const before = ledger.db.prepare("SELECT * FROM entries").all();
    const changes = ledger.db.prepare("SELECT total_changes() AS n").get().n;
    const global = ledger.runtimeReport({});
    const result = ledger.runtimeReport({ session: " S " });
    assert.deepEqual(result.coverage, {
      includedEntries: 3,
      excludedEntries: 0,
      excludedByCertainty: {},
    });
    assert.deepEqual(result.agents, [
      {
        agent: "red",
        entries: 3,
        sessions: 1,
        totalTokens: (BigInt(huge) * 2n).toString(),
      },
    ]);
    assert.equal(result.models[0].tokens.input, (BigInt(huge) * 2n).toString());
    assert.equal(result.models[0].entries, 3);
    assert.equal(result.models[0].sessions, 1);
    assert.deepEqual(result.runtime.coverage, {
      recordedEntries: 1,
      missingEntries: 2,
      unknownCurrencyEntries: 1,
    });
    assert.equal(result.runtime.currency, null);
    assert.equal(result.runtime.total, null);
    assert.equal(result.runtime.observations[0].amount, 0);
    assert.equal(result.runtime.observations[0].session, " S ");
    assert.equal(
      ledger.runtimeReport({ session: "S" }).agents[0].agent,
      "unknown",
    );
    assert.equal(
      ledger.runtimeReport({ session: "s" }).coverage.includedEntries,
      0,
    );
    const copied = ledger.runtimeReport({ session: "child" });
    assert.deepEqual(copied.coverage, {
      includedEntries: 0,
      excludedEntries: 2,
      excludedByCertainty: { copied: 1, "lineage-unresolved": 1 },
    });
    assert.deepEqual(copied.agents, []);
    assert.deepEqual(copied.models, []);
    assert.equal(copied.runtime.coverage.missingEntries, 0);
    assert.deepEqual(
      ledger.runtimeReport({ session: "amb" }).coverage.excludedByCertainty,
      { "session-ambiguous": 1 },
    );
    assert.deepEqual(ledger.runtimeReport({}), global);
    assert.deepEqual(ledger.db.prepare("SELECT * FROM entries").all(), before);
    assert.equal(
      ledger.db.prepare("SELECT total_changes() AS n").get().n,
      changes,
    );
    result.agents[0].agent = "mutated";
    result.models[0].tokens.input = "0";
    result.runtime.observations[0].amount = 999;
    ledger.close();
    ledger = openLedger(f.db);
    assert.equal(
      ledger.runtimeReport({ session: " S " }).agents[0].agent,
      "red",
    );
    assert.equal(
      ledger.runtimeReport({ session: " S " }).runtime.observations[0].amount,
      0,
    );
    ledger.importFiles({ tasks: [f.task("u", selected, "blue")] });
    assert.equal(
      ledger.runtimeReport({ session: " S " }).agents[0].agent,
      "unknown",
    );
    const other = before.find((row) => row.session === "S");
    ledger.db
      .prepare("UPDATE entries SET data=? WHERE session=? AND entry=?")
      .run(
        JSON.stringify({ ...JSON.parse(other.data), input: -1 }),
        other.session,
        other.entry,
      );
    assert.doesNotThrow(() => ledger.runtimeReport({ session: " S " }));
    assert.throws(
      () => ledger.runtimeReport({ session: "S" }),
      /^Error: Runtime report operation failed$/,
    );
    assert.throws(
      () => ledger.runtimeReport({}),
      /Runtime report operation failed/,
    );
  } finally {
    ledger.close();
  }
});

test("runtimeReport one snapshot across independent entry and task commit", () => {
  const f = fixture();
  const path = f.file("source.jsonl", [header("s"), message("one")]);
  const task = f.task("actor", path, "red");
  const ledger = openLedger(f.db);
  const prepare = ledger.db.prepare.bind(ledger.db);
  try {
    ledger.importFiles({ sessions: [path], tasks: [task] });
    f.file("source.jsonl", [header("s"), message("one"), message("two")]);
    f.task("actor", path, "blue");
    let fired = false;
    ledger.db.prepare = (sql) => {
      const stmt = prepare(sql);
      if (sql === "SELECT * FROM entries" && !fired) {
        const all = stmt.all.bind(stmt);
        stmt.all = (...args) => {
          const rows = all(...args);
          fired = true;
          const child = spawnSync(
            process.execPath,
            ["test/writer.js", "--commit", f.db, path, task],
            { timeout: 10000, encoding: "utf8" },
          );
          assert.equal(child.status, 0, child.stderr);
          return rows;
        };
      }
      return stmt;
    };
    const report = ledger.runtimeReport({ session: "s" });
    assert.deepEqual(report.agents, [
      { agent: "red", entries: 1, sessions: 1, totalTokens: "19" },
    ]);
    assert.equal(report.models[0].entries, 1);
    assert.equal(report.runtime.coverage.missingEntries, 1);
    assert.equal(report.coverage.includedEntries, 1);
    assert.equal(fired, true);
    const next = ledger.runtimeReport({});
    assert.deepEqual(next.agents, [
      { agent: "blue", entries: 2, sessions: 1, totalTokens: "38" },
    ]);
    assert.equal(next.models[0].entries, 2);
    assert.equal(next.runtime.coverage.missingEntries, 2);
  } finally {
    ledger.db.prepare = prepare;
    ledger.close();
  }
});

test("runtimeReport mixed agents and binary ordering keep views nonadditive", () => {
  const f = fixture();
  const ledger = openLedger(f.db);
  try {
    const paths = ["é", "z", "a"].map((agent) =>
      f.file(
        `${agent}.jsonl`,
        [
          header(agent),
          message("z", { model: "z", usage: { ...usage, cost: { total: 0 } } }),
          message("a", { model: "a", usage: { ...usage, cost: { total: 0 } } }),
        ].slice(0, agent === "a" ? 2 : 3),
      ),
    );
    ledger.importFiles({
      sessions: paths,
      tasks: paths.map((path, i) =>
        f.task(`actor${i}`, path, ["é", "z", "a"][i]),
      ),
    });
    const report = ledger.runtimeReport({});
    assert.deepEqual(
      report.agents.map((g) => [g.agent, g.totalTokens]),
      [
        ["z", "38"],
        ["é", "38"],
        ["a", "19"],
      ],
    );
    assert.deepEqual(
      report.models.map((g) => [g.model, g.sessions]),
      [
        ["z", 3],
        ["a", 2],
      ],
    );
    assert.equal(
      report.agents.reduce((sum, g) => sum + g.sessions, 0),
      3,
    );
    assert.equal(
      report.models.reduce((sum, g) => sum + g.sessions, 0),
      5,
    );
    assert.deepEqual(
      report.runtime.observations.map((r) => [r.session, r.entry]),
      [
        ["a", "z"],
        ["z", "a"],
        ["z", "z"],
        ["é", "a"],
        ["é", "z"],
      ],
    );
    assert.equal(report.coverage.includedEntries, 5);
  } finally {
    ledger.close();
  }
});

test("runtimeReport sanitizes read, commit and rollback failures and recovers", () => {
  const f = fixture();
  const ledger = openLedger(f.db);
  const exec = ledger.db.exec.bind(ledger.db);
  const prepare = ledger.db.prepare.bind(ledger.db);
  try {
    for (const failure of ["read", "commit", "rollback"]) {
      ledger.db.prepare = (sql) => {
        if (failure !== "commit") throw new Error("PRIVATE_SENTINEL");
        return prepare(sql);
      };
      ledger.db.exec = (sql) => {
        if (sql === "COMMIT") throw new Error("PRIVATE_SENTINEL");
        const result = exec(sql);
        if (sql === "ROLLBACK" && failure === "rollback")
          throw new Error("PRIVATE_SENTINEL");
        return result;
      };
      assert.throws(
        () => ledger.runtimeReport({}),
        /^Error: Runtime report operation failed$/,
      );
      ledger.db.exec = exec;
      ledger.db.prepare = prepare;
      assert.doesNotThrow(() => ledger.runtimeReport({}));
    }
  } finally {
    ledger.db.exec = exec;
    ledger.db.prepare = prepare;
    ledger.close();
  }
});

test("modelUsage validates empty requests before SQL and returns empty coverage", () => {
  const f = fixture();
  const ledger = openLedger(f.db);
  const exec = ledger.db.exec.bind(ledger.db);
  ledger.db.exec = () => assert.fail("invalid request reached SQL");
  for (const value of [
    undefined,
    null,
    [],
    0,
    "",
    { extra: 1 },
    { [Symbol("extra")]: 1 },
    Object.defineProperty({}, "extra", { value: 1 }),
  ]) {
    assert.throws(() => ledger.modelUsage(value), {
      message: "Invalid model usage",
    });
  }
  ledger.db.exec = exec;
  assert.deepEqual(ledger.modelUsage({}), {
    provenance: "imported-own-model-usage",
    groups: [],
    coverage: {
      includedEntries: 0,
      excludedEntries: 0,
      excludedByCertainty: {},
    },
  });
  ledger.importFiles({
    sessions: [
      f.file("zero.jsonl", [
        header("zero"),
        message("zero", {
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
          },
        }),
      ]),
    ],
  });
  assert.deepEqual(ledger.modelUsage({}).groups[0].tokens, {
    input: "0",
    output: "0",
    cacheRead: "0",
    cacheWrite: "0",
    totalTokens: "0",
  });
  ledger.close();
});

test("modelUsage exact global groups preserve literal identities and detached state", () => {
  const f = fixture();
  const ledger = openLedger(f.db);
  const large = {
    input: Number.MAX_SAFE_INTEGER,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: Number.MAX_SAFE_INTEGER,
  };
  const identities = [
    ["z", "big"],
    [null, null],
    ["Sin clasificar", "Sin clasificar"],
    ["a|b", "c"],
    ["a", "b|c"],
    ["A", "m"],
    ["a", "m"],
    ["é", "m"],
    ["😀", "m"],
    [" spaced ", " m "],
  ];
  const first = f.file("first.jsonl", [
    header("first"),
    ...identities.map(([provider, model], i) =>
      message(String(i), {
        provider,
        model,
        usage: i === 0 ? large : usage,
      }),
    ),
    message("empty", { provider: "", model: "" }),
  ]);
  const second = f.file("second.jsonl", [
    header("second"),
    message("large", { provider: "z", model: "big", usage: large }),
  ]);
  ledger.importFiles({ sessions: [first, second] });
  const state = () => [
    ledger.entries(),
    ledger.accounting(),
    ledger.ranking(),
    ledger.coverage(),
  ];
  const before = state();
  const storage = () =>
    createHash("sha256").update(readFileSync(f.db)).digest("hex");
  const hash = storage();
  const changes = ledger.db.prepare("SELECT total_changes() AS n").get().n;
  const prepare = ledger.db.prepare.bind(ledger.db);
  const reads = [];
  ledger.db.prepare = (sql) => {
    reads.push(sql);
    return prepare(sql);
  };
  const result = ledger.modelUsage({});
  ledger.db.prepare = prepare;
  assert.deepEqual(reads, ["SELECT * FROM sources", "SELECT * FROM entries"]);
  assert.deepEqual(
    result.groups.map((g) => [g.provider, g.model]),
    [
      identities[0],
      identities[1],
      identities[9],
      identities[5],
      identities[2],
      identities[4],
      identities[6],
      identities[3],
      identities[7],
      identities[8],
    ],
  );
  assert.deepEqual(result.groups[0], {
    provider: "z",
    model: "big",
    entries: 2,
    sessions: 2,
    tokens: {
      input: "18014398509481982",
      output: "0",
      cacheRead: "0",
      cacheWrite: "0",
      totalTokens: "18014398509481982",
    },
  });
  assert.deepEqual(result.groups[1].tokens, {
    input: "20",
    output: "8",
    cacheRead: "6",
    cacheWrite: "4",
    totalTokens: "38",
  });
  assert.equal(result.groups[1].sessions, 1);
  assert.equal(
    result.groups.reduce((n, g) => n + g.entries, 0),
    12,
  );
  assert.deepEqual(result.coverage, {
    includedEntries: 12,
    excludedEntries: 0,
    excludedByCertainty: {},
  });
  assert.equal(
    ledger.db.prepare("SELECT total_changes() AS n").get().n,
    changes,
  );
  assert.equal(storage(), hash);
  assert.deepEqual(state(), before);
  const expected = structuredClone(result);
  result.groups[0].tokens.input = "0";
  result.coverage.includedEntries = -1;
  ledger.importFiles({ tasks: [f.task("late", first)] });
  assert.deepEqual(ledger.modelUsage({}), expected);
  ledger.close();
  const reopened = openLedger(f.db);
  assert.deepEqual(reopened.modelUsage({}), expected);
  reopened.close();
});

test("modelUsage excludes every dynamic uncertainty without summing its tokens", () => {
  const f = fixture();
  const ledger = openLedger(f.db);
  const parent = f.file("parent.jsonl", [header("p"), message("copy")]);
  const child = f.file("child.jsonl", [
    header("c", { parentSession: parent }),
    message("copy"),
    message("unmatched"),
    message("copy-conflict", { usage }),
  ]);
  appendFileSync(
    parent,
    `${JSON.stringify(message("copy-conflict", { model: "different" }))}\n`,
  );
  const other = f.file("other.jsonl", [
    header("o"),
    message("bad", { usage: {} }),
    message("nested", { role: "toolResult" }),
    message("conflict"),
  ]);
  ledger.importFiles({ sessions: [parent, child, other] });
  const ambiguous = f.file("ambiguous.jsonl", [
    header("o"),
    message("ambiguous"),
  ]);
  ledger.importFiles({ sessions: [ambiguous] });
  appendFileSync(
    other,
    `${JSON.stringify(message("conflict", { model: "changed" }))}\n`,
  );
  ledger.importFiles({ sessions: [other] });
  const isolated = f.file("isolated.jsonl", [
    header("i"),
    message("incomplete", { usage: {} }),
    message("nested", { role: "toolResult" }),
  ]);
  ledger.importFiles({ sessions: [isolated] });
  assert.deepEqual(ledger.modelUsage({}).coverage, {
    includedEntries: 2,
    excludedEntries: 9,
    excludedByCertainty: {
      copied: 1,
      "lineage-unresolved": 1,
      "lineage-conflict": 1,
      "session-ambiguous": 3,
      "identity-conflict": 1,
      incomplete: 1,
      "nested-unknown": 1,
    },
  });
  assert.equal(
    ledger
      .modelUsage({})
      .groups.reduce(
        (sum, group) => sum + BigInt(group.tokens.totalTokens),
        0n,
      ),
    38n,
  );
  assert.deepEqual(
    ledger.runtimeReport({}).coverage,
    ledger.modelUsage({}).coverage,
  );
  assert.deepEqual(
    ledger.runtimeReport({}).models,
    ledger.modelUsage({}).groups,
  );
  appendFileSync(
    parent,
    `${JSON.stringify(message("copy", { model: "changed" }))}\n`,
  );
  ledger.importFiles({ sessions: [parent] });
  assert.equal(ledger.modelUsage({}).coverage.includedEntries, 1);
  assert.deepEqual(
    ledger.runtimeReport({}).coverage,
    ledger.modelUsage({}).coverage,
  );
  assert.deepEqual(
    ledger.runtimeReport({}).models,
    ledger.modelUsage({}).groups,
  );
  ledger.close();
});

test("modelUsage uses one deferred WAL snapshot across independent commit", () => {
  const f = fixture();
  const ledger = openLedger(f.db);
  ledger.importFiles({
    sessions: [f.file("s.jsonl", [header("s"), message("one")])],
  });
  const other = openLedger(f.db);
  const prepare = ledger.db.prepare.bind(ledger.db);
  ledger.db.prepare = (sql) => {
    const stmt = prepare(sql);
    if (sql !== "SELECT * FROM sources") return stmt;
    return {
      all: () => {
        const rows = stmt.all();
        other.db.exec("BEGIN IMMEDIATE");
        other.db.prepare("UPDATE entries SET conflict=1").run();
        other.db.exec("COMMIT");
        return rows;
      },
    };
  };
  assert.equal(ledger.modelUsage({}).coverage.includedEntries, 1);
  ledger.db.prepare = prepare;
  assert.deepEqual(ledger.modelUsage({}).coverage, {
    includedEntries: 0,
    excludedEntries: 1,
    excludedByCertainty: { "identity-conflict": 1 },
  });
  other.close();
  ledger.close();
});

test("modelUsage generic failures roll back and corrupted own counters never become zero", () => {
  const f = fixture();
  const ledger = openLedger(f.db);
  ledger.importFiles({
    sessions: [f.file("s.jsonl", [header("s"), message("one")])],
  });
  const prepare = ledger.db.prepare.bind(ledger.db);
  const exec = ledger.db.exec.bind(ledger.db);
  const expected = ledger.modelUsage({});
  for (const failure of ["prepare", "read", "COMMIT", "ROLLBACK"]) {
    ledger.db.prepare = (sql) => {
      if (failure === "prepare" || failure === "ROLLBACK") {
        throw new Error("private");
      }
      if (failure === "read") {
        return {
          all: () => {
            throw new Error("private");
          },
        };
      }
      return prepare(sql);
    };
    ledger.db.exec = (sql) => {
      if (sql === failure) throw new Error("private");
      return exec(sql);
    };
    assert.throws(() => ledger.modelUsage({}), {
      message: "Model usage operation failed",
    });
    ledger.db.prepare = prepare;
    ledger.db.exec = exec;
    if (failure === "ROLLBACK") exec("ROLLBACK");
    assert.deepEqual(ledger.modelUsage({}), expected);
  }
  const original = prepare("SELECT data FROM entries").get().data;
  for (const input of [null, -1, 0, 0.5, "10", Number.MAX_SAFE_INTEGER + 1]) {
    prepare("UPDATE entries SET data=?").run(
      JSON.stringify({ ...JSON.parse(original), input }),
    );
    assert.throws(() => ledger.modelUsage({}), {
      message: "Model usage operation failed",
    });
  }
  prepare("UPDATE entries SET data=?").run("{");
  assert.throws(() => ledger.modelUsage({}), {
    message: "Model usage operation failed",
  });
  prepare("UPDATE entries SET data=?").run(original);
  assert.deepEqual(ledger.modelUsage({}), expected);
  ledger.close();
});

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

function summaryFixture() {
  const f = fixture();
  const ledger = openLedger(f.db);
  ledger.importFiles({
    sessions: [
      f.file("summary.jsonl", [
        header("s"),
        message("one"),
        message("two"),
        message("zero", {
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
          },
        }),
      ]),
    ],
  });
  const add = (id, entry = "one", currency = "USD") =>
    ledger.addImportedEstimate({ id, session: "s", entry, currency });
  add("unknown");
  for (const category of coreCategories)
    ledger.addManualPrice({ ...manualPrice, category });
  add("first");
  add("alternative");
  add("second", "two");
  add("zero", "zero");
  add("euro", "two", "EUR");
  const summarize = (ids, currency = "USD") =>
    ledger.summarizeImportedEstimates({ ids, currency });
  return { f, ledger, add, summarize };
}

test("imported summary validates exact dense requests before SQL", () => {
  const { ledger } = summaryFixture();
  const prepare = ledger.db.prepare.bind(ledger.db);
  ledger.db.prepare = () => assert.fail("invalid request reached SQL");
  const request = { ids: ["first"], currency: "USD" };
  for (const value of [
    undefined,
    null,
    [],
    {},
    { ...request, extra: 1 },
    { ...request, [Symbol()]: 1 },
    { ids: new Array(1), currency: "USD" },
    { ...request, ids: ["first", "first"] },
    ...[
      null,
      "first",
      [null],
      [""],
      [" first"],
      ["a\n"],
      ["a".repeat(513)],
      Object.assign(["first"], { extra: 1 }),
    ].map((ids) => ({ ...request, ids })),
    ...["usd", "US", "USD\n", 123].map((currency) => ({
      ...request,
      currency,
    })),
  ])
    assert.throws(() => ledger.summarizeImportedEstimates(value), {
      message: "Invalid imported estimate summary",
    });
  ledger.db.prepare = prepare;
  ledger.close();
});

test("imported summary rejects alternatives and missing or mismatched selection", () => {
  const { ledger, summarize } = summaryFixture();
  for (const ids of [
    ["missing"],
    ["first", "missing"],
    ["first", "alternative"],
    ["first", "euro"],
  ])
    assert.throws(() => summarize(ids), {
      message: "Invalid imported estimate summary",
    });
  assert.deepEqual(summarize([]), {
    provenance: "selected-imported-estimate-summary",
    currency: "USD",
    ids: [],
    total: null,
    coverage: {
      complete: false,
      selected: 0,
      completeQuotes: 0,
      incomplete: [],
    },
  });
  assert.equal(summarize(["zero"]).total, "0.000000000000");
  assert.deepEqual(summarize(["second", "unknown"]).coverage, {
    complete: false,
    selected: 2,
    completeQuotes: 1,
    incomplete: [
      { id: "unknown", missingCounters: [], missingPrices: coreCategories },
    ],
  });
  assert.equal(summarize(["second", "unknown"]).total, null);
  ledger.close();
});

test("imported summary preserves historical snapshots and performs only one selected read", () => {
  const { f, ledger, add, summarize } = summaryFixture();
  const original = summarize(["second", "first"]);
  assert.equal(original.total, "0.000038000000");
  ledger.addManualPrice({
    ...manualPrice,
    effectiveFrom: "2025-12-01T00:00:00.000Z",
    ratePerMillion: "9",
  });
  ledger.importFiles({
    sessions: [
      f.file("summary.jsonl", [
        header("s"),
        message("one", { model: "conflict" }),
      ]),
    ],
  });
  assert.equal(add("first").quote.total, "0.000019000000");
  assert.deepEqual(summarize(["first", "second"]), original);
  const state = () => [
    ledger.accounting(),
    ledger.coverage(),
    ledger.ranking(),
    ledger.entries(),
    ledger.db.prepare("SELECT * FROM imported_estimates").all(),
  ];
  const before = state();
  const hash = createHash("sha256").update(readFileSync(f.db)).digest("hex");
  const prepare = ledger.db.prepare.bind(ledger.db);
  const exec = ledger.db.exec.bind(ledger.db);
  let reads = 0;
  ledger.db.exec = () => assert.fail("summary executed SQL writes/transaction");
  ledger.db.prepare = (sql) => {
    reads++;
    assert.match(sql, /^SELECT .*imported_estimates/s);
    assert.doesNotMatch(sql, /JOIN|manual_prices|FROM entries/i);
    return prepare(sql);
  };
  const result = summarize(["second", "first"]);
  assert.equal(reads, 1);
  result.ids.pop();
  result.coverage.incomplete.push({ id: "mutated" });
  ledger.db.prepare = prepare;
  ledger.db.exec = exec;
  assert.deepEqual(state(), before);
  assert.equal(
    createHash("sha256").update(readFileSync(f.db)).digest("hex"),
    hash,
  );
  ledger.close();
  const reopened = openLedger(f.db);
  assert.deepEqual(
    reopened.summarizeImportedEstimates({
      ids: ["first", "second"],
      currency: "USD",
    }),
    original,
  );
  reopened.close();
});

test("imported summary exact large money, literal pairs and SQLite binary Unicode order", () => {
  const { ledger, summarize } = summaryFixture();
  const saved = ledger.importedEstimate({ id: "first" });
  const insert = ledger.db.prepare(
    "INSERT INTO imported_estimates VALUES (?,?,?)",
  );
  const ids = ["\u{10000}", "\ue000"];
  for (const [index, id] of ids.entries()) {
    const estimate = structuredClone(saved);
    Object.assign(estimate, {
      id,
      session: index ? "a" : "a:b",
      entry: index ? "b:c" : "c",
    });
    let total = 0n;
    for (const category of coreCategories) {
      const part = estimate.quote.categories[category];
      part.tokens = Number.MAX_SAFE_INTEGER;
      part.price.ratePerMillion = "999999999999.999999";
      const scaled = 999999999999999999n * BigInt(part.tokens);
      part.amount = `${scaled / 1000000000000n}.${(scaled % 1000000000000n).toString().padStart(12, "0")}`;
      estimate.observation.usage[category] = part.tokens;
      total += scaled;
    }
    estimate.quote.total = `${total / 1000000000000n}.${(total % 1000000000000n).toString().padStart(12, "0")}`;
    insert.run(id, "{}", JSON.stringify(estimate));
  }
  const result = summarize(ids);
  assert.deepEqual(result.ids, [ids[1], ids[0]]);
  assert.equal(result.total, "72057594037927927927942.405962072072");
  ledger.close();
});

test("imported summary selected corruption and reader failures are atomic and generic", () => {
  const { ledger, summarize } = summaryFixture();
  const prepare = ledger.db.prepare.bind(ledger.db);
  for (const fail of [
    () => {
      throw new Error("PRIVATE");
    },
    () => ({
      all() {
        throw new Error("PRIVATE");
      },
    }),
  ]) {
    ledger.db.prepare = fail;
    assert.throws(() => summarize(["first"]), {
      message: "Imported estimate summary operation failed",
    });
  }
  ledger.db.prepare = prepare;
  const saved = ledger.importedEstimate({ id: "first" });
  const update = prepare(
    "UPDATE imported_estimates SET estimate=? WHERE id='first'",
  );
  for (const serialized of [
    "{",
    "null",
    "{}",
    ...[
      "01.000000000000",
      "-1.000000000000",
      "1.0",
      1,
      "1.000000000000\n",
      "1.000000000000",
    ].map((total) =>
      JSON.stringify({ ...saved, quote: { ...saved.quote, total } }),
    ),
    JSON.stringify({
      ...saved,
      quote: {
        ...saved.quote,
        coverage: { complete: false, missingCounters: [], missingPrices: [] },
      },
    }),
  ]) {
    update.run(serialized);
    assert.equal(summarize(["second"]).total, "0.000019000000");
    assert.throws(() => summarize(["first", "second"]), {
      message: "Imported estimate summary operation failed",
    });
  }
  ledger.close();
});

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

test("addManualPrice rolls back failed confirmation and recovers on the same handle", () => {
  const ledger = openLedger(":memory:");
  const prepare = ledger.db.prepare.bind(ledger.db);
  let inserted = false;
  ledger.db.prepare = (sql) => {
    const stmt = prepare(sql);
    if (sql.includes("INSERT INTO manual_prices")) {
      const run = stmt.run.bind(stmt);
      stmt.run = (...args) => {
        const result = run(...args);
        inserted = true;
        return result;
      };
    }
    if (sql.includes("SELECT * FROM manual_prices")) {
      stmt.get = () => {
        assert.equal(inserted, true);
        throw new Error("synthetic private path SQL value");
      };
    }
    return stmt;
  };
  try {
    assert.throws(() => ledger.addManualPrice(manualPrice), {
      message: "Manual price operation failed",
    });
  } finally {
    ledger.db.prepare = prepare;
  }
  assert.equal(inserted, true);
  assert.deepEqual(ledger.manualPrices(manualQuery), []);
  const canonical = { ...manualPrice, ratePerMillion: "1.000000" };
  assert.deepEqual(ledger.addManualPrice(manualPrice), canonical);
  assert.deepEqual(
    ledger.addManualPrice({ ...manualPrice, ratePerMillion: "1.0" }),
    canonical,
  );
  assert.throws(
    () => ledger.addManualPrice({ ...manualPrice, ratePerMillion: "2" }),
    { message: "Manual price conflict" },
  );
  const next = {
    ...manualPrice,
    effectiveFrom: "2027-01-01T00:00:00.000Z",
    ratePerMillion: "2",
  };
  assert.deepEqual(ledger.addManualPrice(next), {
    ...next,
    ratePerMillion: "2.000000",
  });
  assert.deepEqual(ledger.manualPrices(manualQuery), [
    canonical,
    { ...next, ratePerMillion: "2.000000" },
  ]);
  ledger.close();
});

test("addManualPrice preserves caller transaction ownership and rollback", () => {
  const ledger = openLedger(":memory:");
  const canonical = ledger.addManualPrice(manualPrice);
  const outerPrice = { ...manualPrice, category: "output" };
  const failedPrice = { ...manualPrice, category: "cacheRead" };
  const prepare = ledger.db.prepare.bind(ledger.db);
  ledger.db.exec("BEGIN IMMEDIATE");
  assert.deepEqual(ledger.addManualPrice(outerPrice), {
    ...outerPrice,
    ratePerMillion: "1.000000",
  });
  ledger.db.prepare = (sql) => {
    const stmt = prepare(sql);
    if (sql.includes("SELECT * FROM manual_prices"))
      stmt.get = () => {
        throw new Error("synthetic private confirmation");
      };
    return stmt;
  };
  try {
    assert.throws(() => ledger.addManualPrice(failedPrice), {
      message: "Manual price operation failed",
    });
  } finally {
    ledger.db.prepare = prepare;
  }
  assert.deepEqual(
    ledger.manualPrices(manualQuery).map((row) => row.category),
    ["input", "output"],
  );
  assert.throws(
    () => ledger.addManualPrice({ ...manualPrice, ratePerMillion: "2" }),
    { message: "Manual price conflict" },
  );
  ledger.addManualPrice(failedPrice);
  ledger.db.exec("ROLLBACK");
  assert.deepEqual(ledger.manualPrices(manualQuery), [canonical]);
  ledger.db.exec("BEGIN IMMEDIATE");
  ledger.addManualPrice(outerPrice);
  ledger.db.exec("COMMIT");
  assert.equal(ledger.manualPrices(manualQuery).length, 2);
  ledger.addManualPrice(failedPrice);
  assert.equal(ledger.manualPrices(manualQuery).length, 3);
  ledger.close();
});

test("addManualPrice sanitizes lifecycle and cleanup failures before recovery", () => {
  for (const stage of [
    "savepoint",
    "insert",
    "missing",
    "release",
    "rollback",
    "cleanup",
  ]) {
    const ledger = openLedger(":memory:");
    const prepare = ledger.db.prepare.bind(ledger.db);
    const exec = ledger.db.exec.bind(ledger.db);
    let failed = false;
    ledger.db.prepare = (sql) => {
      if (stage === "insert" && sql.includes("INSERT INTO manual_prices"))
        throw new Error("synthetic private SQL value");
      const stmt = prepare(sql);
      if (sql.includes("SELECT * FROM manual_prices")) {
        if (stage === "missing") stmt.get = () => undefined;
        if (["rollback", "cleanup"].includes(stage))
          stmt.get = () => {
            throw new Error("synthetic private path");
          };
      }
      return stmt;
    };
    ledger.db.exec = (sql) => {
      if (
        !failed &&
        ((stage === "savepoint" && sql === "SAVEPOINT add_manual_price") ||
          (stage === "release" && sql === "RELEASE add_manual_price"))
      ) {
        failed = true;
        throw new Error("synthetic private lifecycle");
      }
      const result = exec(sql);
      if (
        (stage === "rollback" && sql === "ROLLBACK TO add_manual_price") ||
        (stage === "cleanup" && sql === "RELEASE add_manual_price")
      )
        throw new Error("synthetic private cleanup");
      return result;
    };
    try {
      assert.throws(
        () => ledger.addManualPrice(manualPrice),
        { message: "Manual price operation failed" },
        stage,
      );
    } finally {
      ledger.db.prepare = prepare;
      ledger.db.exec = exec;
    }
    assert.deepEqual(ledger.manualPrices(manualQuery), [], stage);
    // A cleanup failure can leave a savepoint open; caller recovery is explicit.
    if (stage === "rollback") exec("ROLLBACK");
    assert.doesNotThrow(() => exec("BEGIN IMMEDIATE"), stage);
    exec("ROLLBACK");
    assert.doesNotThrow(() => ledger.addManualPrice(manualPrice), stage);
    ledger.close();
  }
  const ledger = openLedger(":memory:");
  const prepare = ledger.db.prepare.bind(ledger.db);
  const exec = ledger.db.exec.bind(ledger.db);
  ledger.db.prepare = ledger.db.exec = () => {
    assert.fail("invalid requests must not execute SQL");
  };
  assert.throws(() => ledger.addManualPrice({ ...manualPrice, extra: true }), {
    message: "Invalid manual price",
  });
  ledger.db.prepare = prepare;
  ledger.db.exec = exec;
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

function checkedEstimateFixture() {
  const f = fixture();
  const ledger = openLedger(f.db);
  const source = f.file("checked.jsonl", [header("s"), message("one")]);
  ledger.importFiles({ sessions: [source] });
  const request = { id: "checked", ...importedRequest };
  const incomplete = ledger.addImportedEstimate({ ...request, id: "unknown" });
  for (const category of coreCategories)
    ledger.addManualPrice({ ...manualPrice, category });
  const saved = ledger.addImportedEstimate(request);
  const replace = (value) =>
    ledger.db
      .prepare("UPDATE imported_estimates SET estimate=? WHERE id='checked'")
      .run(JSON.stringify(value));
  return { f, ledger, source, request, incomplete, saved, replace };
}

test("imported checked reader rejects corrupt structures, identities and exact money", () => {
  const { ledger, saved, incomplete, replace } = checkedEstimateFixture();
  const changes = [
    ["observation", undefined],
    ["quote.categories.input", undefined],
    ["id", "other"],
    ["session", ""],
    ["currency", "EUR"],
    ["provenance", "manual-estimate"],
    ["usageProvenance", "caller-explicit"],
    ["eligibility.eligible", false],
    ["eligibility.reasons", ["not-own"]],
    ["observation.certainty", "copied"],
    ["observation.usage.input", -1],
    ["quote.provider", "other"],
    ["quote.at", "now"],
    ["quote.provenance", "runtime-estimate"],
    ["quote.categories.input.tokens", "10"],
    ["quote.categories.input.price.currency", "EUR"],
    ["quote.categories.input.price.category", "output"],
    ["quote.categories.input.price.provider", "other"],
    ["quote.categories.input.price.effectiveFrom", "2027-01-01T00:00:00.000Z"],
    ["quote.categories.input.price.ratePerMillion", "2.000000"],
    ["quote.coverage.complete", 1],
    ["quote.coverage.missingCounters", ["input"]],
    ["quote.coverage.missingPrices", null],
    ["quote.total", null],
    ["quote.coverage.complete", false],
    ["quote.categories.input.amount", "bogus"],
  ];
  for (const amount of [
    1,
    "NaN",
    "-1.000000000000",
    "01.000000000000",
    "0.1",
    "0.0000000000000",
    "0.000019000000\n",
    "0.000020000000",
  ])
    changes.push(["quote.total", amount]);
  const corrupt = changes.map(([path, value]) => {
    const s = structuredClone(saved);
    const keys = path.split(".");
    const last = keys.pop();
    const parent = keys.reduce((object, key) => object[key], s);
    parent[last] = value;
    return JSON.parse(JSON.stringify(s));
  });
  const wrongIncomplete = structuredClone(incomplete);
  wrongIncomplete.id = "checked";
  wrongIncomplete.quote.total = "0.000000000000";
  for (const value of [null, [], {}, wrongIncomplete, ...corrupt]) {
    replace(value);
    assert.throws(() => ledger.importedEstimate({ id: "checked" }), {
      message: "Imported estimate operation failed",
    });
    // Enumeration and canonical creation retries deliberately remain unchanged.
    assert.deepEqual(
      ledger.addImportedEstimate({ id: "checked", ...importedRequest }),
      value,
    );
    assert.ok(
      ledger
        .importedEstimates({})
        .estimates.some((s) => JSON.stringify(s) === JSON.stringify(value)),
    );
  }
  ledger.db
    .prepare("UPDATE imported_estimates SET estimate='{' WHERE id='checked'")
    .run();
  assert.throws(() => ledger.importedEstimate({ id: "checked" }), {
    message: "Imported estimate operation failed",
  });
  ledger.close();
});

test("imported checked reader preserves valid snapshots, history and read-only storage", () => {
  const { f, ledger, source, request, incomplete, saved, replace } =
    checkedEstimateFixture();
  const variants = [saved, { ...saved, extra: { future: true } }];
  const zero = structuredClone(saved);
  const huge = structuredClone(saved);
  let total = 0n;
  for (const category of coreCategories) {
    zero.observation.usage[category] = 0;
    zero.quote.categories[category].tokens = 0;
    zero.quote.categories[category].amount = "0.000000000000";
    huge.observation.usage[category] = Number.MAX_SAFE_INTEGER;
    const part = huge.quote.categories[category];
    part.tokens = Number.MAX_SAFE_INTEGER;
    part.price.ratePerMillion = "999999999999.999999";
    const amount = 999999999999999999n * BigInt(part.tokens);
    part.amount = `${amount / 1000000000000n}.${(amount % 1000000000000n).toString().padStart(12, "0")}`;
    total += amount;
  }
  zero.quote.total = "0.000000000000";
  huge.quote.total = `${total / 1000000000000n}.${(total % 1000000000000n).toString().padStart(12, "0")}`;
  const unknown = structuredClone(incomplete);
  unknown.id = request.id;
  unknown.observation.usage.input = null;
  unknown.quote.categories.input.tokens = null;
  unknown.quote.coverage.missingCounters = ["input"];
  variants.push(zero, huge, unknown);
  appendFileSync(
    source,
    JSON.stringify(message("one", { model: "changed" })) + "\n",
  );
  ledger.importFiles({ sessions: [source] });
  ledger.addManualPrice({
    ...manualPrice,
    effectiveFrom: "2025-12-01T00:00:00.000Z",
    ratePerMillion: "9",
  });
  for (const value of variants) {
    replace(value);
    const before = [ledger.accounting(), ledger.ranking(), ledger.coverage()];
    const prepare = ledger.db.prepare.bind(ledger.db);
    const exec = ledger.db.exec.bind(ledger.db);
    const hash = createHash("sha256").update(readFileSync(f.db)).digest("hex");
    let reads = 0;
    ledger.db.exec = () => assert.fail("reader executed transaction/write");
    ledger.db.prepare = (sql) => {
      reads++;
      assert.equal(sql, "SELECT estimate FROM imported_estimates WHERE id=?");
      return prepare(sql);
    };
    const copy = ledger.importedEstimate({ id: request.id });
    assert.deepEqual(copy, value);
    assert.equal(reads, 1);
    copy.quote.categories.input.tokens = 42;
    ledger.db.prepare = prepare;
    ledger.db.exec = exec;
    assert.deepEqual(ledger.importedEstimate({ id: request.id }), value);
    assert.deepEqual(
      [ledger.accounting(), ledger.ranking(), ledger.coverage()],
      before,
    );
    assert.equal(
      createHash("sha256").update(readFileSync(f.db)).digest("hex"),
      hash,
    );
  }
  ledger.close();
  const reopened = openLedger(f.db);
  assert.deepEqual(reopened.importedEstimate({ id: request.id }), unknown);
  assert.equal(reopened.importedEstimate({ id: "absent" }), null);
  const prepare = reopened.db.prepare.bind(reopened.db);
  for (const fail of [
    () => {
      throw Error("PRIVATE");
    },
    () => ({
      get() {
        throw Error("PRIVATE");
      },
    }),
  ]) {
    reopened.db.prepare = fail;
    assert.throws(() => reopened.importedEstimate({ id: request.id }), {
      message: "Imported estimate operation failed",
    });
  }
  reopened.db.prepare = prepare;
  reopened.close();
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
