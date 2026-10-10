import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { openLedger, openReadonlyLedger } from "../src/ledger.js";
import { startDashboard } from "../src/dashboard.js";
import { projectDemo, renderDashboard } from "../src/dashboard-report.js";
import {
  sessionFilterScript,
  sessionFilterForm,
} from "../src/session-filter-form.js";
import { runInNewContext } from "node:vm";
import http from "node:http";

function request(server, selector) {
  const port = server.address().port;
  const body = selector === undefined ? null : JSON.stringify(selector);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: body === null ? "/" : "/session-filter",
        method: body === null ? "GET" : "POST",
        headers:
          body === null
            ? {}
            : {
                Origin: `http://127.0.0.1:${port}`,
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
              },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode, body: text }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
const literal = " 私😀e\u0301 ";
function fixture() {
  const dir = mkdtempSync(resolve("test/.runtime-task-context-"));
  const db = join(dir, "audit.sqlite");
  const file = (name, rows) => {
    const path = join(dir, name);
    writeFileSync(path, rows.map(JSON.stringify).join("\n") + "\n");
    return path;
  };
  const session = (name, id, extra = {}) =>
    file(name, [
      { type: "session", version: 3, id, ...extra },
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
    ]);
  const task = (name, id, sessionPath) =>
    file(name, [{ task: { id, sessionPath, agent: "worker" } }]);
  const a = session("a.jsonl", "a");
  const b = session("b.jsonl", "b");
  const ta = task("ta.json", literal, a);
  const tb = task("tb.json", "second", a);
  const writer = openLedger(db);
  writer.importFiles({ sessions: [a, b], tasks: [ta, tb] });
  return { dir, db, file, session, task, a, b, ta, tb, writer };
}
const joint = (ledger, selection) =>
  ledger.dashboardReport
    ? ledger.dashboardReport({ currency: "EUR", ...selection })
    : {
        runtime: ledger.runtimeReport(selection),
        costs: ledger.costReport({ currency: "EUR", ...selection }),
        evolution: ledger.tokenEvolution(selection),
      };

test("task context overlaps shared sessions once across all joint readers", () => {
  const f = fixture();
  try {
    const expected = joint(f.writer, { session: "a" });
    for (const taskId of [literal, "second"]) {
      assert.deepEqual(joint(f.writer, { taskId }), expected);
      assert.deepEqual(f.writer.runtimeReport({ taskId }), expected.runtime);
      assert.deepEqual(
        f.writer.costReport({ currency: "EUR", taskId }),
        expected.costs,
      );
      assert.deepEqual(f.writer.tokenEvolution({ taskId }), expected.evolution);
    }
    assert.deepEqual(expected.runtime.attributionCoverage, {
      "no-task": 0,
      "missing-agent": 0,
      "conflicting-agents": 0,
      "task-consensus": 1,
    });
    assert.equal(expected.evolution.buckets[0].totalTokens, "19");
    assert.equal(expected.costs.groups[0].total, null);
    const empty = joint(f.writer, { session: "missing" });
    assert.ok(
      Object.values(empty.runtime.attributionCoverage).every((n) => n === 0),
    );
    assert.deepEqual(joint(f.writer, { taskId: "missing" }), empty);
    f.writer.importFiles({
      tasks: [f.task("dangling.json", "dangling", join(f.dir, "absent.jsonl"))],
    });
    assert.deepEqual(joint(f.writer, { taskId: "dangling" }), empty);
  } finally {
    f.writer.close();
  }
});

test("task selectors reject invalid, mixed and unknown keys before SQL", (t) => {
  const f = fixture();
  const reader = openReadonlyLedger(f.db);
  try {
    t.mock.method(DatabaseSync.prototype, "prepare", () =>
      assert.fail("selector reached SQLite"),
    );
    t.mock.method(DatabaseSync.prototype, "exec", () =>
      assert.fail("selector began snapshot"),
    );
    for (const selector of [
      { taskId: null },
      { taskId: "" },
      { taskId: "x".repeat(513) },
      { taskId: literal, session: "a" },
      { taskId: literal, projectId: "Repo" },
      { taskId: literal, extra: true },
    ]) {
      for (const method of ["runtimeReport", "tokenEvolution"])
        assert.throws(() => f.writer[method](selector), /Invalid/);
      assert.throws(
        () => f.writer.costReport({ currency: "EUR", ...selector }),
        /Invalid/,
      );
      assert.throws(
        () => reader.dashboardReport({ currency: "EUR", ...selector }),
        /Invalid/,
      );
    }
    const inherited = Object.create(
      { currency: "EUR" },
      { taskId: { value: literal } },
    );
    assert.throws(() => f.writer.costReport(inherited), /Invalid/);
    assert.throws(() => reader.dashboardReport(inherited), /Invalid/);
  } finally {
    t.mock.restoreAll();
    reader.close();
    f.writer.close();
  }
});

test("task selection retains global ancestry and conservative source ambiguity", () => {
  const f = fixture();
  try {
    const child = f.session("child.jsonl", "child", { parentSession: f.a });
    f.writer.importFiles({
      sessions: [child],
      tasks: [f.task("child.json", "child-task", child)],
    });
    assert.deepEqual(
      joint(f.writer, { taskId: "child-task" }),
      joint(f.writer, { session: "child" }),
    );
    const copied = f.writer.runtimeReport({ taskId: "child-task" });
    assert.deepEqual(copied.coverage.excludedByCertainty, { copied: 1 });
    assert.ok(Object.values(copied.attributionCoverage).every((n) => n === 0));
    const mixed = f.file("mixed.jsonl", [
      { type: "session", version: 3, id: "mixed", parentSession: f.a },
      {
        type: "message",
        id: "unmatched",
        message: {
          role: "assistant",
          usage: {
            input: 1,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 1,
          },
        },
      },
    ]);
    const nested = f.file("nested.jsonl", [
      { type: "session", version: 3, id: "nested" },
      {
        type: "message",
        id: "nested",
        message: {
          role: "toolResult",
          usage: {
            input: 1,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 1,
          },
        },
      },
    ]);
    f.writer.importFiles({
      sessions: [mixed, nested],
      tasks: [
        f.task("mixed.json", "mixed-task", mixed),
        f.task("nested.json", "nested-task", nested),
      ],
      projectMappings: [mixed, nested].map((sessionPath) => ({
        sessionPath,
        projectId: "Mixed",
      })),
    });
    for (const selection of [
      { session: "mixed" },
      { taskId: "mixed-task" },
      { taskId: "nested-task" },
      { projectId: "Mixed" },
    ]) {
      const report = f.writer.runtimeReport(selection);
      assert.deepEqual(
        report.coverage.excludedByCertainty,
        selection.projectId
          ? { "lineage-unresolved": 1, "nested-unknown": 1 }
          : selection.taskId === "nested-task"
            ? { "nested-unknown": 1 }
            : { "lineage-unresolved": 1 },
      );
      assert.ok(
        Object.values(report.attributionCoverage).every((n) => n === 0),
      );
    }
    const alias = f.session("alias.jsonl", "a");
    f.writer.importFiles({ sessions: [alias] });
    const result = f.writer.tokenEvolution({ taskId: literal });
    assert.equal(result.coverage.includedEntries, 0);
    assert.equal(result.coverage.excludedByCertainty["session-ambiguous"], 1);
  } finally {
    f.writer.close();
  }
});

test("task CLI report and admission, dashboard startup and HTTP snapshots", async (t) => {
  const f = fixture();
  const run = (script, ...args) =>
    spawnSync(process.execPath, [`src/${script}.js`, ...args], {
      encoding: "utf8",
      timeout: 10000,
    });
  try {
    const report = run("cli", "report", "--db", f.db, "--task-id", literal);
    assert.equal(report.status, 0, report.stderr);
    assert.deepEqual(
      JSON.parse(report.stdout),
      f.writer.runtimeReport({ taskId: literal }),
    );
    for (const script of ["cli", "dashboard"]) {
      const prefix = script === "cli" ? ["report"] : [];
      assert.match(run(script, ...prefix, "--help").stdout, /--task-id/);
      for (const args of [
        ["--task-id", "x".repeat(513)],
        ["--task-id", literal, "--session", "a"],
        ["--project", "Repo", "--task-id", literal],
      ])
        assert.equal(
          run(script, ...prefix, "--db", join(f.dir, "missing.sqlite"), ...args)
            .status,
          2,
        );
    }
    const child = spawn(
      process.execPath,
      [
        "src/dashboard.js",
        "--db",
        f.db,
        "--currency",
        "EUR",
        "--task-id",
        literal,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const exited = once(child, "exit");
    try {
      const output = await Promise.race([
        once(child.stdout, "data"),
        exited.then(() => {
          throw Error("CLI failed before listen");
        }),
      ]);
      const address = new URL(output[0].toString().trim());
      const page = await request({
        address: () => ({ port: Number(address.port) }),
      });
      const snapshot = joint(f.writer, { taskId: literal });
      assert.equal(
        page.body,
        renderDashboard(
          projectDemo(snapshot.runtime, snapshot.costs, snapshot.evolution),
          { selected: true, taskSelected: true },
        ),
      );
    } finally {
      child.kill("SIGTERM");
      await exited;
    }
    const server = await startDashboard({
      db: f.db,
      currency: "EUR",
      taskId: literal,
      allowManualPrices: true,
    });
    try {
      const startup = await request(server);
      assert.match(
        startup.body,
        /Sesiones vinculadas a la tarea; no consumo exclusivo/,
      );
      assert.doesNotMatch(startup.body, new RegExp(literal));
      assert.match(startup.body, /id="manual-price-form"/);
      for (const selector of [
        { taskId: literal },
        { taskId: "missing" },
        {},
        { session: "b" },
        { projectId: "Repo" },
      ]) {
        const reader = openReadonlyLedger(f.db);
        let expected;
        try {
          const snapshot = joint(reader, selector);
          expected = renderDashboard(
            projectDemo(snapshot.runtime, snapshot.costs, snapshot.evolution),
            {
              selected: true,
              taskSelected: selector.taskId !== undefined,
              sessionSelected: selector.session !== undefined,
              projectSelected: selector.projectId !== undefined,
              allowManualPrices: true,
            },
          );
        } finally {
          reader.close();
        }
        assert.deepEqual(await request(server, selector), {
          status: 200,
          body: expected,
        });
        assert.deepEqual(await request(server), startup);
      }
      f.file("ta.json", [
        { task: { id: literal, sessionPath: f.a, agent: null } },
      ]);
      f.writer.importFiles({ tasks: [f.ta] });
      const fresh = await request(server, { taskId: literal });
      assert.match(fresh.body, /<td>missing-agent<\/td><td>1<\/td>/);
      assert.match(fresh.body, /comparten sesión se solapan/);
      assert.doesNotMatch(fresh.body, new RegExp(literal));
      assert.ok(!fresh.body.includes(f.dir));
      const empty = await request(server, { taskId: "missing" });
      assert.match(empty.body, /<td>missing-agent<\/td><td>0<\/td>/);
      assert.deepEqual(await request(server), startup);
      let calls = 0;
      for (const method of ["prepare", "exec", "close"])
        t.mock.method(DatabaseSync.prototype, method, () => {
          calls++;
          throw Error("PRIVATE");
        });
      for (const selector of [
        { taskId: null },
        { taskId: "x".repeat(513) },
        { taskId: literal, session: "a" },
        { taskId: literal, extra: true },
      ])
        await assert.rejects(request(server, selector), { code: "ECONNRESET" });
      assert.equal(calls, 0);
      t.mock.restoreAll();
      assert.deepEqual(await request(server), startup);
    } finally {
      t.mock.restoreAll();
      await new Promise((done) => server.close(done));
    }
  } finally {
    f.writer.close();
  }
});

test("task client native controls, literal payload, pending and preserved errors", async () => {
  assert.match(sessionFilterForm, /option value="task"/);
  assert.match(sessionFilterForm, /name="taskId"[^>]*maxlength="512"/);
  const controls = Object.fromEntries(
    ["mode", "session", "projectId", "taskId"].map((name) => [
      name,
      { value: name === "mode" ? "task" : literal, disabled: false },
    ]),
  );
  const button = { disabled: false };
  const feedback = { textContent: "" };
  let submit,
    finish,
    payload,
    requests = 0,
    replaced = 0;
  const region = {
    querySelector: (selector) =>
      selector === "[data-dashboard-scope]" ? {} : null,
  };
  const form = {
    elements: { namedItem: (name) => controls[name] },
    addEventListener: (event, handler) => {
      assert.equal(event, "submit");
      submit = handler;
    },
  };
  runInNewContext(sessionFilterScript, {
    document: {
      getElementById: (id) =>
        ({
          "session-filter-form": form,
          "session-filter-submit": button,
          "session-filter-feedback": feedback,
          "dashboard-report": {
            replaceWith: () => {
              replaced++;
            },
          },
        })[id],
    },
    fetch: async (url, options) => {
      assert.equal(url, "/session-filter");
      requests++;
      payload = JSON.parse(options.body);
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    DOMParser: class {
      parseFromString() {
        return { querySelectorAll: () => [region] };
      }
    },
  });
  const event = { preventDefault() {} };
  const pending = submit(event);
  assert.deepEqual(payload, { taskId: literal });
  assert.ok(
    button.disabled &&
      Object.values(controls).every((control) => control.disabled),
  );
  await submit(event);
  assert.equal(requests, 1);
  finish({
    status: 200,
    headers: { get: () => "text/html" },
    text: async () => "",
  });
  await pending;
  assert.equal(replaced, 1);
  assert.ok(
    !button.disabled &&
      Object.values(controls).every((control) => !control.disabled),
  );
  for (const value of ["", "x".repeat(513)]) {
    controls.taskId.value = value;
    await submit(event);
    assert.equal(requests, 1);
  }
  controls.taskId.value = literal;
  const failed = submit(event);
  finish({ status: 500 });
  await failed;
  assert.equal(replaced, 1);
  assert.match(feedback.textContent, /Vista anterior conservada/);
  assert.ok(!feedback.textContent.includes(literal));
});

test("task joint snapshot preserves BigInt, prices and current mapping across a commit", (t) => {
  const f = fixture();
  const large = Number.MAX_SAFE_INTEGER;
  const path = f.file("large.jsonl", [
    { type: "session", version: 3, id: "large" },
    ...["one", "two"].map((id) => ({
      type: "message",
      id,
      timestamp: "2026-01-01T00:00:00.000Z",
      message: {
        role: "assistant",
        provider: "synthetic",
        model: "fixture",
        usage: {
          input: large,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: large,
        },
      },
    })),
  ]);
  try {
    f.writer.importFiles({
      sessions: [path],
      tasks: [f.task("large.json", "large-task", path)],
    });
    for (const category of ["input", "output", "cacheRead", "cacheWrite"])
      f.writer.addManualPrice({
        provider: "synthetic",
        model: "fixture",
        category,
        currency: "EUR",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        ratePerMillion: "1",
      });
    const expected = joint(f.writer, { session: "large" });
    assert.equal(
      expected.evolution.buckets[0].totalTokens,
      (2n * BigInt(large)).toString(),
    );
    assert.equal(
      expected.runtime.models[0].tokens.totalTokens,
      expected.evolution.buckets[0].totalTokens,
    );
    assert.equal(expected.costs.groups[0].total, "18014398509.481982000000");
    assert.equal(
      f.writer.costReport({ currency: "USD", taskId: "large-task" }).groups[0]
        .total,
      null,
    );
    const reader = openReadonlyLedger(f.db);
    const prepare = DatabaseSync.prototype.prepare;
    let fired = false;
    t.mock.method(DatabaseSync.prototype, "prepare", function (sql) {
      const stmt = prepare.call(this, sql);
      if (
        !fired &&
        sql.includes("SELECT s.session FROM sources s JOIN tasks t")
      ) {
        const all = stmt.all.bind(stmt);
        stmt.all = (...args) => {
          const rows = all(...args);
          fired = true;
          f.writer.importFiles({
            tasks: [f.task("large.json", "large-task", f.b)],
          });
          return rows;
        };
      }
      return stmt;
    });
    try {
      assert.deepEqual(joint(reader, { taskId: "large-task" }), expected);
      assert.equal(fired, true);
      assert.deepEqual(
        joint(reader, { taskId: "large-task" }),
        joint(f.writer, { session: "b" }),
      );
    } finally {
      t.mock.restoreAll();
      reader.close();
    }
  } finally {
    t.mock.restoreAll();
    f.writer.close();
  }
});

test("task current metadata updates, reimport and reopen without fanout", () => {
  const f = fixture();
  f.writer.close();
  const ledger = openLedger(f.db);
  try {
    f.task("ta.json", literal, f.b);
    ledger.importFiles({ tasks: [f.ta] });
    assert.deepEqual(
      joint(ledger, { taskId: literal }),
      joint(ledger, { session: "b" }),
    );
    assert.deepEqual(
      joint(ledger, { taskId: "second" }),
      joint(ledger, { session: "a" }),
    );
    const before = joint(ledger, {});
    assert.equal(before.runtime.attributionCoverage["task-consensus"], 2);
    const detached = joint(ledger, { taskId: literal });
    detached.runtime.attributionCoverage["task-consensus"] = 999;
    assert.equal(
      joint(ledger, { taskId: literal }).runtime.attributionCoverage[
        "task-consensus"
      ],
      1,
    );
    ledger.importFiles({ sessions: [f.a, f.b], tasks: [f.ta, f.tb] });
    assert.deepEqual(joint(ledger, {}), before);
    const reader = openReadonlyLedger(f.db);
    try {
      assert.deepEqual(
        joint(reader, { taskId: literal }),
        joint(ledger, { session: "b" }),
      );
    } finally {
      reader.close();
    }
    for (const taskId of [" ", "x".repeat(512), "😀".repeat(256)])
      assert.deepEqual(
        joint(ledger, { taskId }),
        joint(ledger, { session: "missing" }),
      );
  } finally {
    ledger.close();
  }
});
