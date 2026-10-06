import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { openLedger } from "../src/ledger.js";

function fixture() {
  const dir = mkdtempSync(resolve("test/.runtime-"));
  const home = join(dir, "home");
  mkdirSync(home);
  const db = join(dir, "db", "audit.sqlite");
  const file = (name, rows, tail = "") => {
    const path = join(dir, name);
    writeFileSync(path, rows.map(JSON.stringify).join("\n") + "\n" + tail);
    return path;
  };
  const run = (...args) =>
    spawnSync(process.execPath, ["src/cli.js", ...args], {
      encoding: "utf8",
      timeout: 10000,
      env: { ...process.env, HOME: home, USERPROFILE: home, NODE_OPTIONS: "" },
    });
  return { dir, home, db, file, run };
}
const header = (id, extra = {}) => ({
  type: "session",
  version: 3,
  id,
  ...extra,
});
const message = (id) => ({
  type: "message",
  id,
  timestamp: "2026-01-01T00:00:00Z",
  message: {
    role: "assistant",
    content: "PRIVATE_SENTINEL",
    usage: {
      input: 10,
      output: 4,
      cacheRead: 3,
      cacheWrite: 2,
      totalTokens: 19,
    },
  },
});
function json(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    (result.stdout + result.stderr).includes("PRIVATE_SENTINEL"),
    false,
  );
  return JSON.parse(result.stdout);
}

test("CLI report validates without storage and reports separate-process imports", () => {
  const f = fixture();
  for (const args of [
    ["report"],
    ["report", "--db"],
    ["report", "--db", f.db, "--db", f.db],
    ["report", "--session", "x"],
    ["report", "--help", "--oops"],
  ]) {
    assert.equal(f.run(...args).status, 2);
    assert.equal(existsSync(join(f.dir, "db")), false);
  }
  assert.equal(f.run("report", "--help").status, 0);
  assert.equal(f.run("report", "--db", f.db).status, 1);
  assert.equal(existsSync(join(f.dir, "db")), false);
  assert.equal(existsSync(join(f.home, ".local")), false);
  const path = f.file("s.jsonl", [header("s"), message("one")]);
  assert.equal(
    json(f.run("import", "--db", f.db, "--session", path)).report.inserted,
    1,
  );
  const report = json(f.run("report", "--db", f.db));
  assert.equal(report.agents[0].totalTokens, "19");
  assert.equal(report.runtime.total, null);
  assert.equal(report.runtime.coverage.missingEntries, 1);
  const corrupt = f.file("PRIVATE_SENTINEL.sqlite", [{ invalid: true }]);
  for (const db of [corrupt, f.dir]) {
    const result = f.run("report", "--db", db);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Report failed/);
    assert.equal(result.stderr.includes(f.dir), false);
    assert.equal(result.stderr.includes("PRIVATE_SENTINEL"), false);
  }
});

test("CLI help and invalid arguments never create default or explicit storage", () => {
  const f = fixture();
  for (const args of [
    [],
    ["no-command"],
    ["import"],
    ["import", "--unknown"],
    ["import", "--session"],
    ["import", "--task", "--help"],
    ["import", "--db"],
    ["import", "--db", f.db, "--db", f.db],
    ["import", "--db", f.db, "--session", "x", "--oops"],
    ["import", "--session", "x", "--help", "--oops"],
  ]) {
    const result = f.run(...args);
    assert.equal(result.status, 2, JSON.stringify(args));
    assert.equal(result.stdout, "");
    assert.equal(existsSync(join(f.dir, "db")), false);
    assert.equal(existsSync(join(f.home, ".local")), false);
  }
  for (const args of [["--help"], ["import", "--help"]]) {
    const result = f.run(...args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--session/);
    assert.equal(result.stderr, "");
    assert.equal(existsSync(join(f.home, ".local")), false);
  }
});

test("CLI explicit sources survive reimport, restart, tasks first and late attribution", () => {
  const f = fixture();
  const a = f.file("a.jsonl", [header("a"), message("1")], '{"type":');
  const b = f.file("b.jsonl", [header("b"), message("1")]);
  const task = (id, path, agent) =>
    f.file(`${id}.json`, [
      {
        task: { id, sessionPath: path, agent, prompt: "PRIVATE_SENTINEL" },
        thread: "PRIVATE_SENTINEL",
      },
    ]);
  const ta = task("ta", a, "red");
  const tb = task("tb", b, "blue");
  assert.deepEqual(
    json(f.run("import", "--db", f.db, "--task", ta)).ranking,
    [],
  );
  const first = json(
    f.run("import", "--db", f.db, "--session", a, "--session", b),
  );
  assert.equal(first.report.inserted, 2);
  assert.equal(first.report.malformed, 1);
  assert.deepEqual(
    first.coverage.accounting.breakdown
      .map((r) => [r.operation, r.certainty, r.attributionEvidence, r.entries])
      .sort(),
    [
      ["assistant", "own", "no-task", 1],
      ["assistant", "own", "task-consensus", 1],
    ],
  );
  assert.deepEqual(
    first.ranking.map((r) => [r.agent, r.tokens]),
    [
      ["red", 19],
      ["unknown", 19],
    ],
  );
  const again = json(
    f.run("import", "--db", f.db, "--session", a, "--task", ta, "--task", tb),
  );
  assert.equal(again.report.duplicates, 1);
  assert.deepEqual(
    again.ranking.map((r) => [r.agent, r.tokens]),
    [
      ["blue", 19],
      ["red", 19],
    ],
  );
  assert.equal(again.coverage.imports.length, 3);
  assert.equal(again.coverage.accounting.uncertain.entries, 0);
  const breakdown = again.coverage.accounting.breakdown;
  assert.equal(breakdown.length, 1);
  assert.equal(breakdown[0].entries, 2);
  assert.equal(breakdown[0].attributionEvidence, "task-consensus");
  assert.equal(breakdown[0].observed.totalTokens, 38);
  assert.equal(breakdown[0].observed.reasoning, null);
  assert.equal(breakdown[0].missing.reasoning, 2);
  assert.equal(breakdown[0].additive, false);
  for (const suffix of ["", "-wal"]) {
    if (existsSync(f.db + suffix))
      assert.equal(
        readFileSync(f.db + suffix).includes("PRIVATE_SENTINEL"),
        false,
      );
  }
});

test("CLI uncertain child tokens are visible, nonadditive and separate from own ranking", () => {
  const f = fixture();
  const parent = f.file("p.jsonl", [header("p"), message("old")]);
  const child = f.file("c.jsonl", [
    header("c", { parentSession: parent }),
    message("new"),
  ]);
  const output = json(
    f.run("import", "--db", f.db, "--session", parent, "--session", child),
  );
  assert.equal(output.ranking[0].tokens, 19);
  assert.equal(output.coverage.accounting.uncertain.observed.totalTokens, 19);
  assert.equal(output.coverage.accounting.uncertain.additive, false);
});

test("CLI unreadable session or task rolls back with sanitized operational errors", () => {
  const f = fixture();
  const path = f.file("valid.jsonl", [header("s"), message("one")]);
  for (const flag of ["--session", "--task"]) {
    const result = f.run(
      "import",
      "--db",
      f.db,
      "--session",
      path,
      flag,
      join(f.dir, "PRIVATE_SENTINEL-missing"),
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Import failed/);
    assert.equal(result.stderr.includes(f.dir), false);
    assert.equal(result.stderr.includes("PRIVATE_SENTINEL"), false);
    const ledger = openLedger(f.db);
    try {
      assert.equal(ledger.entries().length, 0);
      assert.equal(ledger.coverage().length, 0);
    } finally {
      ledger.close();
    }
  }
  assert.equal(
    json(f.run("import", "--db", f.db, "--session", path)).report.inserted,
    1,
  );
});
