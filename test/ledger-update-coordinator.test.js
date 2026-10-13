import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openReadonlyLedger } from "../src/ledger.js";
import { createLedgerUpdateCoordinator } from "../src/ledger-update-coordinator.js";

const line = (value) => JSON.stringify(value) + "\n";
const usage = (id) => ({
  type: "message",
  id,
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
});
function files(t) {
  const dir = mkdtempSync(join(tmpdir(), "ledger-update-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const session = join(dir, "session.jsonl");
  const task = join(dir, "task.json");
  const db = join(dir, "data", "usage.sqlite");
  writeFileSync(
    session,
    line({ type: "session", version: 3, id: "synthetic" }) +
      line(usage("first")),
  );
  writeFileSync(
    task,
    JSON.stringify({
      task: { id: "task", sessionPath: session, agent: "worker" },
    }),
  );
  return {
    dir,
    session,
    task,
    db,
    config: {
      db,
      currency: "EUR",
      sessions: [session],
      tasks: [task],
      mode: "paused",
    },
  };
}
function mocks(config, overrides = {}) {
  const events = [];
  const instance = createLedgerUpdateCoordinator(config, {
    openWriter: () => {
      events.push("writer");
      return {
        importFiles: (sources) => {
          events.push(["import", sources]);
          return { inserted: 1, duplicates: 0 };
        },
        close: () => events.push("writer-close"),
      };
    },
    openReader: () => {
      events.push("reader");
      return {
        dashboardReport: (request) => {
          events.push(["report", request]);
          return { synthetic: true };
        },
        close: () => events.push("reader-close"),
      };
    },
    now: () => 123,
    ...overrides,
  });
  return { instance, events };
}

test("configuration is lazy, copied and admitted before any opener", async (t) => {
  const f = files(t);
  const { instance, events } = mocks(f.config);
  assert.equal(events.length, 0);
  f.config.sessions.push(join(f.dir, "unapproved.jsonl"));
  f.config.tasks.length = 0;
  f.config.currency = "USD";
  await instance.start();
  assert.deepEqual(events, [
    "writer",
    ["import", { sessions: [f.session], tasks: [f.task] }],
    "writer-close",
    "reader",
    ["report", { currency: "EUR" }],
    "reader-close",
  ]);
  assert.deepEqual(instance.state().report, {
    dashboard: { synthetic: true },
    importReport: { inserted: 1, duplicates: 0 },
  });
  assert.equal(instance.state().lastCompletedAt, 123);
  await instance.stop();
});

test("rejects invalid configuration without opening or creating storage", (t) => {
  const f = files(t);
  let calls = 0;
  const deps = { openWriter: () => calls++, openReader: () => calls++ };
  for (const patch of [
    { db: undefined },
    { db: ":memory:" },
    { db: "relative.sqlite" },
    { db: "file:///tmp/db" },
    { currency: "eur" },
    { currency: "EURO" },
    { sessions: [] },
    { sessions: ["relative"] },
    { sessions: new Array(1) },
    { tasks: [null] },
    { tasks: "not-array" },
    { sessions: [f.session + "\0"] },
    { mode: 15 },
    { session: "scope" },
    { discovery: true },
  ])
    assert.throws(() =>
      createLedgerUpdateCoordinator({ ...f.config, ...patch }, deps),
    );
  for (const name of [
    "openWriter",
    "openReader",
    "schedule",
    "cancel",
    "now",
  ]) {
    assert.throws(() =>
      createLedgerUpdateCoordinator(f.config, { [name]: null }),
    );
  }
  assert.equal(calls, 0);
  assert.equal(existsSync(f.db), false);
});

test("full import includes history, dedupes appends and preserves task attribution", async (t) => {
  const f = files(t);
  let time = 1;
  const c = createLedgerUpdateCoordinator(f.config, { now: () => time++ });
  t.after(() => c.stop());
  await c.start();
  assert.equal(c.state().status, "ready");
  assert.equal(c.state().report.importReport.inserted, 1);
  assert.deepEqual(c.state().report.dashboard.runtime.agents, [
    { agent: "worker", entries: 1, sessions: 1, totalTokens: "19" },
  ]);
  await c.updateNow();
  assert.equal(c.state().report.importReport.inserted, 0);
  assert.equal(c.state().report.importReport.duplicates, 1);
  appendFileSync(f.session, line(usage("second")));
  await c.updateNow();
  const { dashboard, importReport } = c.state().report;
  assert.equal(importReport.inserted, 1);
  assert.equal(importReport.duplicates, 1);
  assert.equal(dashboard.runtime.agents[0].totalTokens, "38");
  assert.equal(dashboard.runtime.models[0].tokens.totalTokens, "38");
  assert.equal(dashboard.evolution.buckets[0].totalTokens, "38");
  const reader = openReadonlyLedger(f.db);
  try {
    assert.deepEqual(dashboard, reader.dashboardReport({ currency: "EUR" }));
  } finally {
    reader.close();
  }
  writeFileSync(
    f.task,
    JSON.stringify({
      task: { id: "task", sessionPath: f.session, agent: "renamed" },
    }),
  );
  await c.updateNow();
  assert.equal(c.state().report.dashboard.runtime.agents[0].agent, "renamed");
  assert.equal(c.state().report.importReport.inserted, 0);
});

test("preserves native malformed/tail semantics and counters without inventing complete coverage", async (t) => {
  const f = files(t);
  appendFileSync(f.session, "invalid-json\n" + JSON.stringify(usage("tail")));
  const c = createLedgerUpdateCoordinator(f.config);
  t.after(() => c.stop());
  await c.start();
  assert.equal(c.state().status, "ready");
  assert.equal(c.state().report.importReport.malformed, 1);
  assert.equal(c.state().report.importReport.inserted, 2);
  assert.equal(c.state().report.dashboard.runtime.agents[0].totalTokens, "38");
  assert.equal(Object.hasOwn(c.state().report, "complete"), false);
});

test("unreadable source retains prior report; fresh attempt may initialize storage", async (t) => {
  const f = files(t);
  const c = createLedgerUpdateCoordinator(f.config);
  t.after(() => c.stop());
  await c.start();
  const previous = c.state().report;
  rmSync(f.task);
  appendFileSync(f.session, line(usage("pending")));
  await c.updateNow();
  assert.equal(c.state().status, "failed");
  assert.equal(c.state().report, previous);
  const reader = openReadonlyLedger(f.db);
  try {
    assert.equal(
      reader.dashboardReport({ currency: "EUR" }).runtime.agents[0].totalTokens,
      "19",
    );
  } finally {
    reader.close();
  }
  const other = join(f.dir, "fresh.sqlite");
  const fresh = createLedgerUpdateCoordinator({ ...f.config, db: other });
  await fresh.start();
  assert.equal(fresh.state().status, "failed");
  assert.equal(existsSync(other), true);
  assert.equal(fresh.state().report, null);
  await fresh.stop();
});

test("coalesces during async writer closure and drains reader closure before publishing", async (t) => {
  const f = files(t);
  const gate = () => {
    let resolve;
    const promise = new Promise((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };
  const writerEntered = gate(),
    writerRelease = gate();
  const readerEntered = gate(),
    readerRelease = gate();
  const { instance: c, events } = mocks(f.config, {
    openWriter: () => ({
      importFiles: () => ({ inserted: 1 }),
      close: async () => {
        writerEntered.resolve();
        await writerRelease.promise;
      },
    }),
    openReader: () => {
      events.push("reader");
      return {
        dashboardReport: () => ({ tokens: "19" }),
        close: async () => {
          readerEntered.resolve();
          await readerRelease.promise;
        },
      };
    },
  });
  const running = c.start();
  await writerEntered.promise;
  assert.equal(c.updateNow(), running);
  assert.equal(events.length, 0);
  writerRelease.resolve();
  await readerEntered.promise;
  assert.equal(c.state().report, null);
  assert.equal(c.state().lastCompletedAt, null);
  let stopped = false;
  const stopping = c.stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  assert.equal(stopped, false);
  readerRelease.resolve();
  await Promise.all([running, stopping]);
  assert.deepEqual(events, ["reader"]);
  assert.equal(c.state().status, "stopped");
  assert.equal(c.state().lastCompletedAt, 123);
});

for (const stage of [
  "writer",
  "import",
  "writer-close",
  "reader",
  "report",
  "reader-close",
]) {
  test(`${stage} failure closes acquired handles, retains snapshot and recovers`, async (t) => {
    const f = files(t);
    let fail = false;
    let time = 1;
    const events = [];
    const step = (name) => {
      events.push(name);
      if (fail && name === stage) throw Error("PRIVATE_PATH");
    };
    const { instance: c } = mocks(f.config, {
      now: () => time,
      openWriter: () => {
        step("writer");
        return {
          importFiles: () => {
            step("import");
            return { inserted: 0 };
          },
          close: () => step("writer-close"),
        };
      },
      openReader: () => {
        step("reader");
        return {
          dashboardReport: () => {
            step("report");
            return { version: time };
          },
          close: () => step("reader-close"),
        };
      },
    });
    await c.start();
    const previous = c.state().report;
    fail = true;
    time = 2;
    events.length = 0;
    await c.updateNow();
    assert.equal(c.state().status, "failed");
    assert.equal(c.state().report, previous);
    assert.equal(c.state().lastCompletedAt, 1);
    assert.doesNotMatch(JSON.stringify(c.state()), /PRIVATE_PATH/);
    if (stage !== "writer") assert.ok(events.includes("writer-close"));
    if (["writer", "import", "writer-close"].includes(stage))
      assert.ok(!events.includes("reader"));
    if (["report", "reader-close"].includes(stage))
      assert.ok(events.includes("reader-close"));
    fail = false;
    await c.updateNow();
    assert.equal(c.state().status, "ready");
    assert.equal(c.state().lastCompletedAt, 2);
    await c.stop();
  });
}
