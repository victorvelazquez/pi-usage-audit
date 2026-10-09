import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  appendFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { pathToFileURL } from "node:url";
import { prepareWatch, runWatch } from "../src/watch.js";
import { openLedger } from "../src/ledger.js";

const header = { type: "session", version: 3, id: "synthetic" };
const line = (value) => JSON.stringify(value) + "\n";
const usage = (id, totalTokens = 19) => ({
  type: "message",
  id,
  timestamp: "2026-01-01T00:00:00Z",
  message: {
    role: "assistant",
    content: "ñ",
    usage: {
      input: 10,
      output: 4,
      cacheRead: 3,
      cacheWrite: 2,
      totalTokens,
    },
  },
});
function fixture() {
  const dir = mkdtempSync(resolve("test/.runtime-watch-"));
  const session = join(dir, "session.jsonl");
  const db = join(dir, "audit.sqlite");
  writeFileSync(session, line(header) + line(usage("history")));
  const run = (...args) =>
    spawnSync(process.execPath, ["src/cli.js", ...args], {
      encoding: "utf8",
      timeout: 10000,
    });
  return { dir, session, db, run };
}

test("watch CLI admission and help precede storage", () => {
  const f = fixture();
  for (const args of [
    ["--session", f.session],
    ["--db", f.db],
    ["--db", f.db, "--session", f.session, "--poll", "1"],
  ]) {
    assert.equal(f.run("watch", ...args).status, 2);
  }
  const help = f.run("watch", "--help");
  assert.equal(help.status, 0);
  assert.match(help.stdout, /watch/);
  assert.equal(existsSync(f.db), false);
  const loader = join(f.dir, "barrier.mjs");
  writeFileSync(
    loader,
    `export async function resolve(specifier, context, next) {
    if (specifier.includes('watch.js') || specifier.includes('ledger.js') ||
        specifier === 'node:sqlite' || specifier === 'node:fs') throw Error('IO_BARRIER');
    return next(specifier, context);
  }`,
  );
  for (const args of [
    ["watch", "--help"],
    ["watch", "--db", f.db],
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-loader",
        pathToFileURL(loader).href,
        "src/cli.js",
        ...args,
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    assert.equal(result.status, args.includes("--help") ? 0 : 2, result.stderr);
    assert.doesNotMatch(result.stderr, /IO_BARRIER/);
  }
});

test("watch excludes baseline, imports append once and leaves idle untouched", async () => {
  const f = fixture();
  const capture = prepareWatch({ sessions: [f.session] });
  const ledger = openLedger(f.db);
  try {
    await capture.cycle(ledger);
    assert.equal(ledger.ranking().length, 0);
    const baseline = ledger.coverage().length;
    assert.equal(await capture.cycle(ledger), null);
    appendFileSync(f.session, line(usage("new")));
    assert.equal((await capture.cycle(ledger)).inserted, 1);
    assert.equal(await capture.cycle(ledger), null);
    assert.equal(ledger.coverage().length, baseline + 1);
  } finally {
    ledger.close();
  }
});

test("partial startup tail, split UTF8 and CRLF are deferred until complete", async () => {
  const f = fixture();
  const bytes = Buffer.from(line(usage("partial")).replace(/\n$/, "\r\n"));
  const split = bytes.indexOf(Buffer.from("ñ")) + 1;
  appendFileSync(f.session, bytes.subarray(0, split));
  const capture = prepareWatch({ sessions: [f.session] });
  const ledger = openLedger(f.db);
  try {
    assert.equal((await capture.cycle(ledger)).inserted, 0);
    appendFileSync(f.session, bytes.subarray(split, -1));
    assert.equal(await capture.cycle(ledger), null);
    appendFileSync(f.session, bytes.subarray(-1));
    assert.equal((await capture.cycle(ledger)).inserted, 1);
    appendFileSync(f.session, "{invalid}\n");
    const count = ledger.coverage().length;
    await assert.rejects(capture.cycle(ledger), /Watch failed at source 0\./);
    assert.equal(ledger.coverage().length, count);
  } finally {
    ledger.close();
  }
});

test("batch validation rejects mutation, truncation, missing and invalid headers", async () => {
  for (const mutate of [
    (f) => writeFileSync(f.session, ""),
    (f) =>
      writeFileSync(
        f.session,
        readFileSync(f.session, "utf8").replace("synthetic", "changed!!"),
      ),
    (f) =>
      writeFileSync(
        f.session,
        readFileSync(f.session, "utf8").replace("history", "rewrite"),
      ),
    (f) => appendFileSync(f.session, line({ ...header, id: "another" })),
  ]) {
    const f = fixture();
    const other = join(f.dir, "other.jsonl");
    writeFileSync(other, line({ ...header, id: "other" }));
    const capture = prepareWatch({ sessions: [other, f.session] });
    const ledger = openLedger(f.db);
    try {
      await capture.cycle(ledger);
      appendFileSync(other, line(usage("valid")));
      mutate(f);
      await assert.rejects(capture.cycle(ledger), /source 1/);
      assert.equal(ledger.ranking().length, 0);
      assert.equal(ledger.coverage().length, 1);
    } finally {
      ledger.close();
    }
  }
  const f = fixture();
  assert.throws(
    () => prepareWatch({ sessions: [join(f.dir, "missing")] }),
    /source 0/,
  );
  writeFileSync(f.session, line({ ...header, version: 1 }));
  assert.throws(() => prepareWatch({ sessions: [f.session] }), /source 0/);
  const result = f.run("watch", "--db", f.db, "--session", f.session);
  assert.equal(result.status, 1);
  assert.equal(existsSync(f.db), false);
  assert.doesNotMatch(result.stderr, /session\.jsonl|synthetic/);
  writeFileSync(f.session, line(header));
  const task = join(f.dir, "invalid-task.json");
  writeFileSync(task, "{}");
  const invalidTask = f.run(
    "watch",
    "--db",
    f.db,
    "--session",
    f.session,
    "--task",
    task,
  );
  assert.equal(invalidTask.status, 1);
  assert.match(invalidTask.stderr, /Watch failed at source 1\./);
  assert.equal(existsSync(f.db), false);
  const badStorage = f.run("watch", "--db", f.dir, "--session", f.session);
  assert.equal(badStorage.status, 1);
  assert.match(badStorage.stderr, /Watch failed\./);
  assert.doesNotMatch(badStorage.stderr, /audit\.sqlite|session\.jsonl/);
});

test("required watch text obeys the ledger's 512 UTF16 limit before storage", async (t) => {
  for (const field of ["header.id", "task.id", "task.sessionPath"]) {
    for (const length of [512, 513]) {
      await t.test(`${field}: ${length} UTF16 units`, () => {
        const f = fixture();
        const task = join(f.dir, "task.json");
        const value = "😀".repeat(256) + (length === 513 ? "x" : "");
        const metadata = { id: "task", sessionPath: "session.jsonl" };
        if (field === "header.id") {
          writeFileSync(f.session, line({ ...header, id: value }));
        } else {
          metadata[field.slice(5)] = value;
        }
        writeFileSync(task, JSON.stringify({ task: metadata }));
        const prepare = () =>
          prepareWatch({ sessions: [f.session], tasks: [task] });
        if (length === 512) {
          assert.doesNotThrow(prepare);
        } else {
          assert.throws(
            prepare,
            new RegExp(`source ${field === "header.id" ? 0 : 1}`),
          );
        }
        assert.equal(existsSync(f.db), false);
      });
    }
  }
});

test("snapshot engine shares dedup, quarantine and transaction rollback with importFiles", async () => {
  const f = fixture();
  const capture = prepareWatch({ sessions: [f.session] });
  const ledger = openLedger(f.db);
  const concurrent = openLedger(f.db);
  try {
    await capture.cycle(ledger);
    appendFileSync(f.session, line(usage("new")));
    assert.equal(concurrent.importFiles({ sessions: [f.session] }).inserted, 2);
    assert.equal((await capture.cycle(ledger)).duplicates, 1);
    appendFileSync(f.session, line(usage("new", 29)));
    assert.equal((await capture.cycle(ledger)).conflicts, 1);
    assert.equal(ledger.accounting().uncertain.entries, 1);
    const before = ledger.coverage();
    assert.throws(
      () =>
        ledger.importSnapshots({
          sessions: [
            {
              path: f.session,
              content: line(header) + line(usage("rolled-back")),
            },
          ],
          tasks: [
            {
              path: "unused",
              get content() {
                throw new Error("synthetic failure");
              },
            },
          ],
        }),
      /synthetic failure/,
    );
    assert.deepEqual(ledger.coverage(), before);
    assert.equal(
      ledger.importSnapshots({
        sessions: [
          {
            path: f.session,
            content: line(header) + line(usage("rolled-back")),
          },
        ],
      }).inserted,
      1,
    );
  } finally {
    concurrent.close();
    ledger.close();
  }
});

test("explicit task metadata updates attribution without reading referenced sessions", async () => {
  const f = fixture();
  const task = join(f.dir, "task.json");
  const save = (agent, sessionPath = "session.jsonl") =>
    writeFileSync(
      task,
      JSON.stringify({ task: { id: "task", sessionPath, agent } }),
    );
  save("Agent");
  const capture = prepareWatch({ sessions: [f.session], tasks: [task] });
  const ledger = openLedger(f.db);
  try {
    await capture.cycle(ledger);
    appendFileSync(f.session, line(usage("new")));
    await capture.cycle(ledger);
    assert.equal(ledger.ranking()[0].agent, "Agent");
    save("Updated");
    assert.ok(await capture.cycle(ledger));
    assert.equal(ledger.ranking()[0].agent, "Updated");
    save("Other", "never-opened.jsonl");
    assert.ok(await capture.cycle(ledger));
    assert.equal(ledger.ranking()[0].agent, "unknown");
    assert.equal(existsSync(join(f.dir, "never-opened.jsonl")), false);
    writeFileSync(task, "{}");
    appendFileSync(f.session, line(usage("blocked")));
    await assert.rejects(capture.cycle(ledger), /source 1/);
  } finally {
    ledger.close();
  }
});

test("failed commit preserves cursors; serial timer stop drains and closes once", async () => {
  const f = fixture();
  const capture = prepareWatch({ sessions: [f.session] });
  const batches = [];
  const ledger = {
    importSnapshots: (batch) => {
      batches.push(batch);
      return {};
    },
  };
  await capture.cycle(ledger);
  appendFileSync(f.session, line(usage("retry")));
  await assert.rejects(
    capture.cycle({
      importSnapshots: () => {
        throw new Error("commit");
      },
    }),
  );
  await capture.cycle(ledger);
  assert.match(batches[1].sessions[0].content, /retry/);
  assert.equal(await capture.cycle(ledger), null);
  const signals = new EventEmitter();
  const events = new EventEmitter();
  let tick;
  let release;
  let calls = 0;
  let closed = 0;
  const ready = once(events, "ready");
  const running = runWatch({
    capture: {
      cycle: async () => {
        calls++;
        if (calls === 2) {
          await new Promise((resolve) => {
            release = resolve;
            events.emit("active");
          });
        }
        return {};
      },
    },
    ledger: { close: () => closed++ },
    signals,
    emit: (event) => events.emit(event.event),
    schedule: (callback, delay) => {
      assert.equal(delay, 1000);
      tick = callback;
      return 1;
    },
    cancel: () => {},
  });
  await ready;
  const active = once(events, "active");
  tick();
  await active;
  signals.emit("SIGINT");
  signals.emit("SIGTERM");
  assert.equal(closed, 0);
  release();
  await running;
  assert.equal(calls, 2);
  assert.equal(closed, 1);
  assert.equal(signals.listenerCount("SIGINT"), 0);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
});

test("idle signal cancels timer; operational failure removes handlers and closes", async () => {
  for (const fail of [false, true]) {
    const signals = new EventEmitter();
    const events = new EventEmitter();
    let closed = 0;
    let cancelled = 0;
    const ready = once(events, "ready");
    const running = runWatch({
      capture: {
        cycle: async () => {
          if (fail) throw new Error("synthetic failure");
          return {};
        },
      },
      ledger: { close: () => closed++ },
      signals,
      emit: (event) => events.emit(event.event),
      schedule: () => 1,
      cancel: () => cancelled++,
    });
    if (fail) {
      await assert.rejects(running, /synthetic failure/);
    } else {
      await ready;
      signals.emit("SIGTERM");
      await running;
      assert.equal(cancelled, 1);
    }
    assert.equal(closed, 1);
    assert.equal(signals.listenerCount("SIGINT"), 0);
    assert.equal(signals.listenerCount("SIGTERM"), 0);
  }
});

test("close failure does not announce a successful stop", async () => {
  const signals = new EventEmitter();
  const output = [];
  await assert.rejects(
    runWatch({
      capture: { cycle: async () => ({}) },
      ledger: {
        close: () => {
          throw new Error("private close failure");
        },
      },
      signals,
      emit: (event) => {
        output.push(event.event);
        if (event.event === "ready") signals.emit("SIGINT");
      },
    }),
    /Watch failed\./,
  );
  assert.deepEqual(output, ["ready"]);
  assert.equal(signals.listenerCount("SIGINT"), 0);
});

test("CLI subprocess emits ready then imported for synthetic append", {
  timeout: 10000,
}, async () => {
  const f = fixture();
  const child = spawn(
    process.execPath,
    ["src/cli.js", "watch", "--db", f.db, "--session", f.session],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const events = new EventEmitter();
  let pending = "";
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdout.on("data", (chunk) => {
    pending += chunk;
    while (pending.includes("\n")) {
      const end = pending.indexOf("\n");
      const event = JSON.parse(pending.slice(0, end));
      pending = pending.slice(end + 1);
      events.emit(event.event, event);
    }
  });
  const exited = once(child, "exit");
  try {
    await once(events, "ready");
    const imported = once(events, "imported");
    appendFileSync(f.session, line(usage("live")));
    const [event] = await imported;
    assert.equal(event.counters.inserted, 1);
    assert.doesNotMatch(JSON.stringify(event), /live|synthetic|session\.jsonl/);
  } finally {
    child.kill("SIGINT");
    const [code] = await exited;
    if (process.platform !== "win32") assert.equal(code, 0);
  }
  assert.doesNotMatch(stderr, /Watch failed/);
});
