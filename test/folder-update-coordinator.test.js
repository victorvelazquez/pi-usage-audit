import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLedger, openReadonlyLedger } from "../src/ledger.js";
import { validateFolderConfig } from "../src/folder-selection.js";
import { createLedgerUpdateCoordinator } from "../src/ledger-update-coordinator.js";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "folder-update-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sessions = join(dir, "sessions");
  const tasks = join(dir, "tasks");
  mkdirSync(sessions);
  mkdirSync(tasks);
  const config = {
    db: join(dir, "usage.sqlite"),
    currency: "EUR",
    sessionsDirs: [sessions],
    tasksDirs: [tasks],
    mode: "paused",
  };
  const add = (id) => {
    const path = join(sessions, `${id}.jsonl`);
    const rows = [
      { type: "session", version: 3, id },
      {
        type: "message",
        id: "entry",
        timestamp: "2026-01-01T00:00:00.000Z",
        message: {
          role: "assistant",
          provider: "synthetic",
          model: "fixture",
          usage: {
            input: 10,
            output: 4,
            cacheRead: 3,
            cacheWrite: 2,
            totalTokens: 19,
          },
        },
      },
    ];
    writeFileSync(path, rows.map(JSON.stringify).join("\n") + "\n");
    return path;
  };
  const task = (id, path, agent = "worker") =>
    writeFileSync(
      join(tasks, `${id}.json`),
      JSON.stringify({ task: { id, sessionPath: path, agent } }),
    );
  return { dir, sessions, tasks, config, add, task };
}

test("pure admission, exclusive shapes and copied folder configuration", async (t) => {
  const f = fixture(t);
  let opens = 0;
  const deps = {
    openWriter: () => {
      opens++;
      return openLedger(f.config.db);
    },
  };
  const absent = join(f.dir, "absent");
  assert.deepEqual(validateFolderConfig({ sessionsDirs: [absent] }), {
    sessionsDirs: [absent],
    tasksDirs: [],
  });
  for (const patch of [
    { sessions: undefined },
    { tasks: [] },
    { sessionsDirs: [] },
    { tasksDirs: new Array(1) },
    { sessionsDirs: ["relative"] },
    { tasksDirs: Array(33).fill(f.tasks) },
    { extra: true },
  ]) {
    assert.throws(() =>
      createLedgerUpdateCoordinator(
        {
          ...f.config,
          ...patch,
        },
        deps,
      ),
    );
  }
  const inherited = Object.assign(
    Object.create({ sessionsDirs: [f.sessions] }),
    { db: f.config.db, currency: "EUR", tasksDirs: [] },
  );
  assert.throws(() => createLedgerUpdateCoordinator(inherited, deps));
  assert.equal(opens, 0);
  const c = createLedgerUpdateCoordinator(f.config, deps);
  t.after(() => c.stop());
  f.config.sessionsDirs.push(absent);
  f.config.tasksDirs.length = 0;
  f.config.currency = "USD";
  const path = f.add("a");
  f.task("a", path);
  assert.equal(opens, 0);
  await c.start();
  assert.equal(c.state().status, "ready");
  assert.equal(c.state().report.dashboard.costs.currency, "EUR");
  assert.equal(c.state().report.dashboard.runtime.agents[0].agent, "worker");
});

test("first scan failure cannot open storage; recovery accepts an empty folder", async (t) => {
  const f = fixture(t);
  rmSync(f.sessions, { recursive: true });
  let opens = 0;
  const c = createLedgerUpdateCoordinator(f.config, {
    openWriter: (path) => {
      opens++;
      return openLedger(path);
    },
  });
  t.after(() => c.stop());
  await c.start();
  assert.equal(c.state().status, "failed");
  assert.equal(opens, 0);
  assert.equal(existsSync(f.config.db), false);
  mkdirSync(f.sessions);
  await c.updateNow();
  assert.equal(c.state().status, "ready");
  assert.equal(c.state().report.importReport.inserted, 0);
  assert.equal(c.state().report.dashboard.runtime.coverage.includedEntries, 0);
});

test("second scan uses current sources and closes writer when selection fails", async (t) => {
  const f = fixture(t);
  let fail = false;
  let closes = 0;
  let readers = 0;
  const c = createLedgerUpdateCoordinator(f.config, {
    openWriter: async (db) => {
      const writer = openLedger(db);
      await Promise.resolve();
      if (fail) rmSync(f.sessions, { recursive: true });
      else f.add("arrived-during-open");
      return {
        importFiles: (sources) => writer.importFiles(sources),
        close: () => {
          closes++;
          writer.close();
        },
      };
    },
    openReader: (db) => {
      readers++;
      return openReadonlyLedger(db);
    },
  });
  t.after(() => c.stop());
  await c.start();
  assert.equal(c.state().report.importReport.inserted, 1);
  const previous = c.state();
  fail = true;
  await c.updateNow();
  assert.equal(c.state().status, "failed");
  assert.equal(c.state().report, previous.report);
  assert.equal(c.state().lastCompletedAt, previous.lastCompletedAt);
  assert.equal(closes, 2);
  assert.equal(readers, 1);
  mkdirSync(f.sessions);
  fail = false;
  await c.updateNow();
  assert.equal(c.state().report.importReport.duplicates, 1);
  assert.equal(c.state().status, "ready");
});

test("new files, dedupe, missing files and tasks-only refresh preserve history", async (t) => {
  const f = fixture(t);
  const a = f.add("a");
  f.task("a", a);
  const c = createLedgerUpdateCoordinator(f.config);
  t.after(() => c.stop());
  await c.start();
  assert.equal(c.state().report.importReport.inserted, 1);
  await c.updateNow();
  assert.equal(c.state().report.importReport.duplicates, 1);
  const b = f.add("b");
  f.task("b", b);
  await c.updateNow();
  assert.equal(c.state().report.importReport.inserted, 1);
  assert.equal(c.state().report.dashboard.runtime.agents[0].totalTokens, "38");
  rmSync(a);
  rmSync(b);
  f.task("a", a, "renamed");
  await c.updateNow();
  assert.equal(c.state().report.importReport.inserted, 0);
  const { dashboard } = c.state().report;
  assert.deepEqual(dashboard.runtime.agents.map((row) => row.agent).sort(), [
    "renamed",
    "worker",
  ]);
  assert.equal(dashboard.evolution.buckets[0].totalTokens, "38");
  const reader = openReadonlyLedger(f.config.db);
  try {
    assert.deepEqual(dashboard, reader.dashboardReport({ currency: "EUR" }));
  } finally {
    reader.close();
  }
});
