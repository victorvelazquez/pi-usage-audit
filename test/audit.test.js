import test from "node:test";
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

test("ranking and entries hold a snapshot across an independent writer commit", () => {
  for (const method of ["ranking", "entries"]) {
    const f = fixture();
    const path = f.file("source.jsonl", [header("s"), message("one")]);
    const task = f.task("actor", path, "red");
    const ledger = openLedger(f.db);
    try {
      ledger.importFiles({ sessions: [path], tasks: [task] });
      f.file("source.jsonl", [header("s"), message("one"), message("two")]);
      f.task("actor", path, "blue");
      const duplicate = f.file("duplicate.jsonl", [
        header("s"),
        message("one"),
      ]);
      const prepare = ledger.db.prepare.bind(ledger.db);
      let fired = false;
      ledger.db.prepare = (sql) => {
        const stmt = prepare(sql);
        const gate =
          method === "ranking"
            ? "SELECT * FROM entries"
            : "SELECT * FROM sources";
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
                method === "ranking" ? path : duplicate,
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

test("default database is outside repository", () => {
  const rel = relative(resolve("."), defaultDatabasePath());
  assert.ok(
    isAbsolute(rel) ||
      rel === ".." ||
      rel.startsWith(".." + (process.platform === "win32" ? "\\" : "/")),
  );
});
