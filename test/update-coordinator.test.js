import test from "node:test";
import assert from "node:assert/strict";
import { createUpdateCoordinator } from "../src/update-coordinator.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(options = {}) {
  const timers = new Map();
  const events = [];
  let id = 0;
  const coordinator = createUpdateCoordinator({
    importSources: async () => {
      events.push("import");
    },
    refreshReport: async () => {
      events.push("report");
      return { tokens: "42" };
    },
    now: () => 1234,
    schedule: (callback, delay) => {
      timers.set(++id, { callback, delay });
      return id;
    },
    cancel: (key) => timers.delete(key),
    ...options,
  });
  return { coordinator, timers, events };
}

for (const minutes of [5, 10, 30]) {
  test(`startup refresh and completion-relative ${minutes}-minute scheduling`, async () => {
    const f = fixture({ mode: minutes });
    assert.equal(f.coordinator.state().lastCompletedAt, null);
    await f.coordinator.start();
    assert.deepEqual(f.events, ["import", "report"]);
    assert.equal(f.coordinator.state().lastCompletedAt, 1234);
    assert.deepEqual(f.coordinator.state().report, { tokens: "42" });
    const [key, timer] = [...f.timers][0];
    assert.equal(timer.delay, minutes * 60_000);
    f.timers.delete(key);
    await timer.callback();
    assert.equal(f.events.length, 4);
    assert.equal(f.timers.size, 1);
    await f.coordinator.stop();
    assert.equal(f.timers.size, 0);
  });
}

test("paused startup still refreshes; manual works; resuming refreshes immediately", async () => {
  const f = fixture({ mode: "paused" });
  await f.coordinator.start();
  assert.equal(f.timers.size, 0);
  await f.coordinator.updateNow();
  assert.equal(f.events.length, 4);
  await f.coordinator.setMode(10);
  assert.equal(f.events.length, 6);
  const stale = [...f.timers.values()][0];
  await f.coordinator.setMode("paused");
  await stale.callback();
  assert.equal(f.events.length, 6);
  assert.equal(f.timers.size, 0);
  await f.coordinator.stop();
});

test("manual refresh cancels wait; frequency changes invalidate old callbacks", async () => {
  const f = fixture();
  await f.coordinator.start();
  const stale = [...f.timers.values()][0];
  await f.coordinator.setMode(30);
  assert.equal([...f.timers.values()][0].delay, 30 * 60_000);
  await stale.callback();
  assert.equal(f.events.length, 2);
  await f.coordinator.updateNow();
  assert.equal(f.events.length, 4);
  assert.equal(f.timers.size, 1);
  await f.coordinator.stop();
});

test("overlapping requests share one cycle; pausing during it does not abort", async () => {
  const gate = deferred();
  const entered = deferred();
  let imports = 0;
  const f = fixture({
    importSources: async () => {
      imports++;
      entered.resolve();
      await gate.promise;
    },
  });
  const first = f.coordinator.start();
  await entered.promise;
  assert.equal(f.coordinator.updateNow(), first);
  assert.equal(f.coordinator.start(), first);
  await f.coordinator.setMode("paused");
  assert.equal(f.coordinator.state().status, "updating");
  assert.equal(f.coordinator.state().lastCompletedAt, null);
  assert.equal(f.timers.size, 0);
  gate.resolve();
  await first;
  assert.equal(imports, 1);
  assert.equal(f.coordinator.state().status, "ready");
  assert.equal(f.timers.size, 0);
  await f.coordinator.stop();
});

test("timestamp and report publish only after report refresh completes", async () => {
  const gate = deferred();
  const entered = deferred();
  const f = fixture({
    refreshReport: async () => {
      entered.resolve();
      await gate.promise;
      return { tokens: "99" };
    },
  });
  const running = f.coordinator.start();
  await entered.promise;
  assert.equal(f.coordinator.state().lastCompletedAt, null);
  assert.equal(f.coordinator.state().report, null);
  gate.resolve();
  await running;
  assert.deepEqual(f.coordinator.state().report, { tokens: "99" });
  await f.coordinator.stop();
});

for (const stage of ["importSources", "refreshReport"]) {
  test(`${stage} failure retains the last report and recovers without exposing errors`, async () => {
    let fail = false;
    let time = 1;
    let refreshes = 0;
    const f = fixture({
      now: () => time,
      importSources: async () => {
        if (fail && stage === "importSources") throw new Error("private-path");
      },
      refreshReport: async () => {
        refreshes++;
        if (fail && stage === "refreshReport") throw new Error("private-path");
        return { tokens: String(time) };
      },
    });
    await f.coordinator.start();
    fail = true;
    time = 2;
    await f.coordinator.updateNow();
    const state = f.coordinator.state();
    assert.equal(state.status, "failed");
    assert.equal(state.lastCompletedAt, 1);
    assert.deepEqual(state.report, { tokens: "1" });
    assert.doesNotMatch(JSON.stringify(state), /private-path/);
    assert.equal(refreshes, stage === "importSources" ? 1 : 2);
    assert.equal(f.timers.size, 1);
    fail = false;
    await f.coordinator.updateNow();
    assert.equal(f.coordinator.state().lastCompletedAt, 2);
    assert.equal(f.coordinator.state().status, "ready");
    await f.coordinator.stop();
  });
}

test("stop cancels scheduling, drains active work and forbids new work", async () => {
  const gate = deferred();
  const entered = deferred();
  const f = fixture({
    importSources: async () => {
      entered.resolve();
      await gate.promise;
    },
  });
  const running = f.coordinator.start();
  await entered.promise;
  let drained = false;
  const stopping = f.coordinator.stop().then(() => {
    drained = true;
  });
  assert.throws(() => f.coordinator.updateNow(), /Coordinator stopped/);
  assert.throws(() => f.coordinator.setMode(5), /Coordinator stopped/);
  await Promise.resolve();
  assert.equal(drained, false);
  gate.resolve();
  await Promise.all([running, stopping, f.coordinator.stop()]);
  assert.equal(f.coordinator.state().status, "stopped");
  assert.equal(f.coordinator.state().lastCompletedAt, 1234);
  assert.equal(f.timers.size, 0);
});

test("validates configuration before callbacks and does not start implicitly", async () => {
  for (const mode of [0, 1, "10", null, 15]) {
    assert.throws(() => fixture({ mode }), /Invalid update mode/);
  }
  assert.throws(() => createUpdateCoordinator({}), /Invalid update callbacks/);
  const f = fixture();
  assert.equal(f.coordinator.state().mode, 10);
  assert.throws(() => f.coordinator.updateNow(), /Coordinator not started/);
  assert.throws(() => f.coordinator.setMode(15), /Invalid update mode/);
  await f.coordinator.setMode("paused");
  assert.equal(f.events.length, 0);
  await f.coordinator.stop();
  assert.throws(() => f.coordinator.start(), /Coordinator stopped/);
});
