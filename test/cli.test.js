import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
  truncateSync,
  symlinkSync,
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
async function selectionFixture() {
  const f = fixture();
  const tasksDir = join(f.dir, "tasks");
  const sessionsDir = join(f.dir, "sessions");
  mkdirSync(tasksDir);
  mkdirSync(sessionsDir);
  const session = (name, id = name) => f.file(`sessions/${name}`, [header(id)]);
  const root = session("root.jsonl", "root");
  const record = (name, task) => f.file(`tasks/${name}.json`, [{ task }]);
  // Task envelopes are JSON, whereas sessions are JSONL.
  const task = (name, fields) => {
    const path = record(name, fields);
    writeFileSync(
      path,
      JSON.stringify({ task: fields, thread: "PRIVATE_SENTINEL" }),
    );
    return path;
  };
  const { selectSessionSources } = await import("../src/session-selection.js");
  const options = { root, tasksDir, sessionsDirs: [sessionsDir] };
  const select = (overrides = {}) =>
    selectSessionSources({ ...options, ...overrides });
  const rejects = (overrides = {}) =>
    assert.throws(() => select(overrides), {
      message: "Session selection failed.",
    });
  const link = (name, sessionPath, parentSessionId = "root") =>
    task(name, { id: name, sessionPath, parentSessionId, agent: "synthetic" });
  return {
    ...f,
    tasksDir,
    sessionsDir,
    root,
    session,
    task,
    link,
    select,
    rejects,
  };
}

test("session selection BFS, continuations, literal IDs and detached recipe", async () => {
  const f = await selectionFixture();
  const a = f.session("a.jsonl", " a ");
  const b = f.session("b.jsonl", "b");
  const grandchild = f.session("grandchild.jsonl", "grandchild");
  const rows = [
    f.task("00", { id: "root-task", sessionPath: "../sessions/root.jsonl" }),
    // Grandchild sorts before its parent: selection must still be breadth-first.
    f.link("01", grandchild, " a "),
    f.link("02", a),
    f.link("03", a),
    f.link("04", b),
  ];
  f.link("foreign", "outside/missing", "foreign");
  mkdirSync(join(f.tasksDir, "nested"));
  writeFileSync(join(f.tasksDir, "nested", "ignored.json"), "invalid");
  writeFileSync(join(f.tasksDir, "ignored.txt"), "invalid");
  const sentinel = join(f.dir, "sentinel.sqlite");
  writeFileSync(sentinel, "unchanged");
  const before = readdirSync(f.dir);
  const result = f.select();
  assert.deepEqual(result.sources, {
    sessions: [f.root, a, b, grandchild],
    tasks: rows,
  });
  assert.deepEqual(result.importArgs, [
    "--session",
    f.root,
    "--session",
    a,
    "--session",
    b,
    "--session",
    grandchild,
    ...rows.flatMap((path) => ["--task", path]),
  ]);
  assert.deepEqual(result.coverage, {
    taskRecordsScanned: 6,
    linkedTasksFound: 5,
    sessionsFound: 4,
    linkedSessionsMissing: 0,
    missingReferencedTasks: null,
    importedSessions: 0,
    importedTasks: 0,
    referenceCoverage: "not-inspected",
    complete: false,
  });
  result.sources.sessions.length = 0;
  assert.equal(f.select().sources.sessions.length, 4);
  assert.deepEqual(readdirSync(f.dir), before);
  assert.equal(readFileSync(sentinel, "utf8"), "unchanged");
  assert.deepEqual(readdirSync(f.home), []);
  assert.equal(existsSync(join(f.dir, "db")), false);
});

test("session selection platform path identity preserves canonical output", async (t) => {
  const f = await selectionFixture();
  const rootTask = f.task("root", {
    id: "root-task",
    sessionPath: f.root.toUpperCase(),
  });
  if (process.platform !== "win32") {
    assert.equal(f.select().coverage.linkedTasksFound, 0);
    f.task("root", { id: "root-task", sessionPath: f.root });
    assert.equal(f.select().coverage.linkedTasksFound, 1);
    t.diagnostic("POSIX: lexical path identity remains case-sensitive");
    return;
  }
  assert.deepEqual(f.select().sources.tasks, [rootTask]);
  const child = f.session("child.jsonl", "Child");
  const first = f.link("child", child.toUpperCase());
  // Same task ID and locator, with different casing, is not a conflict.
  const alias = f.task("continuation", {
    id: "child",
    sessionPath: child,
    parentSessionId: "root",
    agent: "synthetic",
  });
  const continuation = f.task("locator-only", {
    id: "CHILD",
    sessionPath: child.toUpperCase(),
    agent: "different",
  });
  const missing = join(f.sessionsDir, "missing.jsonl");
  f.link("missing-lower", missing);
  f.link("missing-upper", missing.toUpperCase());
  f.link("foreign", "outside/missing", "ROOT");
  const result = f.select();
  assert.deepEqual(result.sources.sessions, [f.root, child]);
  assert.equal(result.coverage.linkedTasksFound, 6);
  assert.equal(result.coverage.linkedSessionsMissing, 1);
  for (const path of [rootTask, first, alias, continuation])
    assert.ok(result.sources.tasks.includes(path));
  t.diagnostic(
    "Windows: mixed-case roots, continuations and missing locators checked",
  );
});

test("session selection absent children and unknown task denominator", async () => {
  const f = await selectionFixture();
  assert.equal(f.select().coverage.missingReferencedTasks, null);
  assert.equal(f.select().coverage.linkedTasksFound, 0);
  for (const id of ["one", "two"]) f.link(id, "../sessions/missing");
  const result = f.select();
  assert.equal(result.coverage.linkedSessionsMissing, 1);
  assert.equal(result.coverage.sessionsFound, 1);
  assert.equal(result.coverage.complete, false);
});

test("session selection admission, headers and relevant conflicts", async () => {
  const f = await selectionFixture();
  for (const options of [
    { root: "" },
    { tasksDir: null },
    { sessionsDirs: [] },
    { sessionsDirs: [3] },
    { extra: true },
  ])
    f.rejects(options);
  for (const value of [
    null,
    {},
    { type: "session", version: 1, id: "x" },
    header(""),
    header("x".repeat(513)),
    header(7),
  ]) {
    writeFileSync(f.root, JSON.stringify(value) + "\n");
    f.rejects();
  }
  writeFileSync(f.root, JSON.stringify(header("x".repeat(512))) + "\n");
  assert.equal(f.select().coverage.sessionsFound, 1);
  writeFileSync(f.root, JSON.stringify(header("root", { version: 2 })) + "\n");
  assert.equal(f.select().coverage.sessionsFound, 1);
  for (const fields of [
    { id: 1 },
    { sessionPath: 1 },
    { parentSessionId: 1 },
    { agent: {} },
  ]) {
    f.task("bad", {
      id: "bad",
      parentSessionId: "root",
      sessionPath: f.root,
      ...fields,
    });
    f.rejects();
  }
  f.task("bad", { id: "same", sessionPath: f.root, agent: "a" });
  f.task("duplicate", { id: "same", sessionPath: f.root, agent: "b" });
  f.rejects();
  f.task("duplicate", {
    id: "same",
    sessionPath: "outside/missing",
    agent: "a",
  });
  f.rejects();
  f.task("duplicate", { id: "same", sessionPath: f.root, agent: "a" });
  assert.equal(f.select().coverage.linkedTasksFound, 2);
  const collision = f.session("collision.jsonl", "root");
  f.link("collision", collision);
  f.rejects();
  writeFileSync(collision, "not-json\n");
  f.rejects();
});

test("session selection lexical scope and symlink ancestors", async (t) => {
  const f = await selectionFixture();
  for (const path of [
    "../../outside/missing",
    "../sessions-sibling/missing",
    f.dir,
  ]) {
    f.link("escape", path);
    f.rejects();
  }
  f.link("escape", "../../outside", "foreign");
  assert.equal(f.select().coverage.linkedTasksFound, 0);
  const alias = join(f.sessionsDir, "alias");
  try {
    symlinkSync(f.dir, alias, "junction");
  } catch (error) {
    if (!["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) throw error;
    t.diagnostic(`Symlink checks unavailable: ${error.code}`);
    return;
  }
  f.rejects({ sessionsDirs: [alias] });
  f.rejects({ tasksDir: join(alias, "tasks") });
  f.rejects({ root: join(alias, "sessions", "root.jsonl") });
  f.link("escape", join(alias, "missing"));
  f.rejects();
  f.link("escape", f.root);
  try {
    symlinkSync(f.root, join(f.tasksDir, "symlink.json"), "file");
  } catch (error) {
    if (!["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) throw error;
    t.diagnostic(
      `File symlink check unavailable; junction checks passed: ${error.code}`,
    );
    return;
  }
  f.rejects();
});

test("session selection exact limits and overflow with sparse sessions", async () => {
  const f = await selectionFixture();
  const MiB = 1024 * 1024;
  const task = f.task("sized", { id: "sized", sessionPath: f.root });
  const content = readFileSync(task, "utf8");
  writeFileSync(task, content + " ".repeat(MiB - Buffer.byteLength(content)));
  assert.equal(statSync(task).size, MiB);
  f.select();
  writeFileSync(
    task,
    content + " ".repeat(MiB + 1 - Buffer.byteLength(content)),
  );
  f.rejects();
  writeFileSync(task, content);
  for (let i = 0; i < 999; i++)
    f.task(`limit-${i}`, { id: `t${i}`, sessionPath: f.root });
  assert.equal(f.select().coverage.taskRecordsScanned, 1000);
  f.task("overflow", { id: "overflow", sessionPath: f.root });
  f.rejects();
  const g = await selectionFixture();
  for (let i = 0; i < 99; i++) {
    const path = g.session(`child-${i}`, `child-${i}`);
    g.link(`child-${i}`, path);
  }
  assert.equal(g.select().coverage.sessionsFound, 100);
  g.link("overflow", g.session("overflow"));
  g.rejects();
  const h = await selectionFixture();
  truncateSync(h.root, 64 * MiB);
  h.select();
  truncateSync(h.root, 64 * MiB + 1);
  h.rejects();
  truncateSync(h.root, 64 * MiB);
  for (let i = 0; i < 3; i++) {
    const path = h.session(`large-${i}`);
    truncateSync(path, 64 * MiB);
    h.link(`large-${i}`, path);
  }
  assert.equal(h.select().coverage.sessionsFound, 4);
  h.link("total-overflow", h.session("extra"));
  h.rejects();
});

function json(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    (result.stdout + result.stderr).includes("PRIVATE_SENTINEL"),
    false,
  );
  return JSON.parse(result.stdout);
}

function planRun(f, args, denySources = false) {
  // In-process loader barrier also detects storage initialization without writes.
  const script = `
    import { registerHooks } from 'node:module';
    registerHooks({ resolve(specifier, context, next) {
      if (specifier === 'node:sqlite' || specifier.endsWith('/ledger.js') ||
          (${denySources} && specifier.endsWith('/session-selection.js'))) {
        process.stderr.write('STORAGE_OR_SOURCE_ACCESS');
        throw new Error('STORAGE_OR_SOURCE_ACCESS');
      }
      return next(specifier, context);
    }});
    process.argv = [process.execPath, 'src/cli.js', ...${JSON.stringify(args)}];
    await import('./src/cli.js');
  `;
  return spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", script],
    {
      encoding: "utf8",
      timeout: 10000,
      env: {
        ...process.env,
        HOME: f.home,
        USERPROFILE: f.home,
        NODE_OPTIONS: "",
      },
    },
  );
}
function snapshot(dir) {
  return readdirSync(dir, { recursive: true })
    .sort()
    .map((name) => {
      const path = join(dir, name);
      return [
        name,
        statSync(path).isFile() ? readFileSync(path).toString("hex") : null,
      ];
    });
}
const planArgs = (f) => [
  "plan",
  "--root",
  f.root,
  "--tasks-dir",
  f.tasksDir,
  "--sessions-dir",
  f.sessionsDir,
];

test("CLI plan delegates deterministic sources without storage or source writes", async () => {
  const f = await selectionFixture();
  const second = join(f.dir, "second sessions");
  mkdirSync(second);
  const child = f.file("second sessions/child.jsonl", [header("child")]);
  f.task("00-root", { id: "root-task", sessionPath: f.root });
  f.link("01-child", child);
  f.link("02-missing", join(f.sessionsDir, "missing.jsonl"));
  f.link("03-foreign", "outside/missing", "foreign");
  const before = snapshot(f.dir);
  const args = [...planArgs(f), "--sessions-dir", second];
  const expected = f.select({ sessionsDirs: [f.sessionsDir, second] });
  const result = planRun(f, args);
  assert.equal(result.stderr, "");
  assert.deepEqual(json(result), expected);
  assert.deepEqual(json(f.run(...args)), expected);
  assert.equal(expected.coverage.complete, false);
  assert.equal(expected.coverage.linkedSessionsMissing, 1);
  assert.deepEqual(snapshot(f.dir), before);
});

test("CLI plan admission and help precede sources and SQLite", async () => {
  const f = await selectionFixture();
  const before = snapshot(f.dir);
  const base = planArgs(f);
  const invalid = [
    ["plan"],
    base.slice(0, 3),
    base.slice(0, 5),
    ["plan", "--tasks-dir", f.tasksDir, "--sessions-dir", f.sessionsDir],
    ["plan", "--root", f.root, "--sessions-dir", f.sessionsDir],
  ];
  for (const flag of ["--root", "--tasks-dir", "--sessions-dir"]) {
    for (const value of [[], [""], ["--literal"]])
      invalid.push([...base, flag, ...value]);
    invalid.push([...base, `${flag}=PRIVATE_SENTINEL`]);
  }
  for (const flag of [
    "--root",
    "--tasks-dir",
    "--db",
    "--session",
    "--task",
    "--oops",
  ])
    invalid.push([...base, flag, "PRIVATE_SENTINEL"]);
  invalid.push([...base, "--help", "--oops"]);
  for (const args of invalid) {
    const result = planRun(f, args, true);
    assert.equal(result.status, 2, JSON.stringify(args));
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "Invalid arguments. Use --help.\n");
  }
  for (const args of [["--help"], ["plan", "--help"], [...base, "--help"]]) {
    const result = planRun(f, args, true);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /plan --root.*--tasks-dir.*--sessions-dir/);
  }
  for (const command of ["import", "report", "costs"])
    assert.equal(planRun(f, [command, "--root", f.root], true).status, 2);
  assert.deepEqual(snapshot(f.dir), before);
});

test("CLI plan sanitizes selection failures and recipe supports manual idempotent import", async () => {
  const f = await selectionFixture();
  const child = f.file("sessions/child.jsonl", [
    header("child"),
    message("one"),
  ]);
  f.link("child", child);
  writeFileSync(
    f.root,
    [header("root"), message("one")].map(JSON.stringify).join("\n") + "\n",
  );
  const before = snapshot(f.dir);
  for (const args of [
    [...planArgs(f), "--sessions-dir", join(f.dir, "PRIVATE_SENTINEL-missing")],
    [
      "plan",
      "--root",
      join(f.dir, "PRIVATE_SENTINEL"),
      "--tasks-dir",
      f.tasksDir,
      "--sessions-dir",
      f.sessionsDir,
    ],
  ]) {
    const failed = planRun(f, args);
    assert.equal(failed.status, 1);
    assert.equal(failed.stdout, "");
    assert.equal(failed.stderr, "Session selection failed.\n");
  }
  assert.deepEqual(snapshot(f.dir), before);
  const plan = json(planRun(f, planArgs(f)));
  assert.deepEqual(snapshot(f.dir), before);
  // Only this explicit existing import command executes the returned argument array.
  const first = json(f.run("import", "--db", f.db, ...plan.importArgs));
  assert.equal(first.report.inserted, 2);
  const again = json(f.run("import", "--db", f.db, ...plan.importArgs));
  assert.equal(again.report.inserted, 0);
  assert.equal(again.report.duplicates, 2);
  assert.deepEqual(again.ranking, first.ranking);
});

test("CLI costs explicit currency, existing storage and API equivalence", () => {
  const f = fixture();
  for (const args of [
    ["costs"],
    ["costs", "--db", f.db],
    ["costs", "--currency", "USD"],
    ["costs", "--db", f.db, "--currency", "usd"],
    ["costs", "--db", f.db, "--currency", "USD", "--currency", "EUR"],
    ["costs", "--db", f.db, "--currency", "USD", "--session", "x"],
  ]) {
    assert.equal(f.run(...args).status, 2);
    assert.equal(existsSync(join(f.dir, "db")), false);
  }
  assert.match(f.run("costs", "--help").stdout, /--currency/);
  assert.equal(f.run("costs", "--db", f.db, "--currency", "USD").status, 1);
  assert.equal(existsSync(join(f.dir, "db")), false);
  const row = message("one");
  row.timestamp = "2026-01-01T00:00:00.000Z";
  row.message.provider = "synthetic";
  row.message.model = "fixture";
  const path = f.file("s.jsonl", [header("s"), row]);
  json(f.run("import", "--db", f.db, "--session", path));
  const ledger = openLedger(f.db);
  let expected;
  try {
    for (const category of ["input", "output", "cacheRead", "cacheWrite"])
      ledger.addManualPrice({
        provider: "synthetic",
        model: "fixture",
        category,
        currency: "USD",
        effectiveFrom: row.timestamp,
        ratePerMillion: "1",
      });
    expected = ledger.costReport({ currency: "USD" });
  } finally {
    ledger.close();
  }
  const result = json(f.run("costs", "--db", f.db, "--currency", "USD"));
  assert.deepEqual(result, expected);
  assert.equal(result.groups[0].total, "0.000019000000");
  const corrupt = f.file("PRIVATE_SENTINEL.sqlite", [{ invalid: true }]);
  const failed = f.run("costs", "--db", corrupt, "--currency", "USD");
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout, "");
  assert.match(failed.stderr, /Cost report failed/);
  assert.equal(failed.stderr.includes("PRIVATE_SENTINEL"), false);
  assert.equal(existsSync(join(f.home, ".local")), false);
});

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

test("CLI report session validates before storage and documents lexical limits", () => {
  const f = fixture();
  for (const flags of [
    ["--session"],
    ["--session", ""],
    ["--session", "x", "--session", "y"],
    ["--session", "x".repeat(513)],
    ["--session", "😀".repeat(256) + "x"],
    ["--session", "--literal"],
    ["--session=x"],
    ["--task", "x"],
  ]) {
    const result = f.run("report", "--db", f.db, ...flags);
    assert.equal(result.status, 2, JSON.stringify(flags));
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Invalid arguments/);
    assert.equal(existsSync(join(f.dir, "db")), false);
    assert.equal(existsSync(join(f.home, ".local")), false);
  }
  const help = f.run("report", "--help");
  assert.equal(help.status, 0);
  assert.match(help.stdout, /report --db existing.sqlite \[--session id\]/);
  assert.match(help.stdout, /512 UTF-16/);
  assert.equal(existsSync(join(f.dir, "db")), false);
  const missing = f.run("report", "--db", f.db, "--session", "s");
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Report failed/);
  assert.equal(existsSync(join(f.dir, "db")), false);
});

test("CLI report session matches API, isolates coverage and preserves literal IDs", () => {
  const f = fixture();
  const ids = ["s", "S", " s ", " ", "x".repeat(512), "😀".repeat(256)];
  const paths = ids.map((id, index) => {
    const row = message("one");
    row.message.model = `fixture-${index}`;
    if (index === 0) row.message.usage.cost = { total: 0 };
    return f.file(`s-${index}.jsonl`, [header(id), row]);
  });
  const imported = json(
    f.run("import", "--db", f.db, ...paths.flatMap((p) => ["--session", p])),
  );
  assert.equal(imported.report.inserted, ids.length);
  const ledger = openLedger(f.db);
  try {
    assert.deepEqual(
      json(f.run("report", "--db", f.db)),
      ledger.runtimeReport({}),
    );
    for (const id of [...ids, "unknown"]) {
      const actual = json(f.run("report", "--db", f.db, "--session", id));
      assert.deepEqual(actual, ledger.runtimeReport({ session: id }));
      assert.equal(actual.coverage.includedEntries, id === "unknown" ? 0 : 1);
      assert.equal(actual.coverage.excludedEntries, 0);
      assert.equal(actual.agents.length, id === "unknown" ? 0 : 1);
      assert.equal(actual.models.length, id === "unknown" ? 0 : 1);
      assert.equal(actual.runtime.coverage.recordedEntries, id === "s" ? 1 : 0);
      assert.equal(
        actual.runtime.coverage.missingEntries,
        id === "s" || id === "unknown" ? 0 : 1,
      );
      assert.equal(actual.runtime.total, null);
      assert.equal(actual.runtime.currency, null);
    }
  } finally {
    ledger.close();
  }
  const corrupt = f.file("PRIVATE_SENTINEL.sqlite", [{ invalid: true }]);
  const failed = f.run(
    "report",
    "--db",
    corrupt,
    "--session",
    "PRIVATE_SENTINEL",
  );
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout, "");
  assert.match(failed.stderr, /Report failed/);
  assert.equal(failed.stderr.includes("PRIVATE_SENTINEL"), false);
  assert.equal(existsSync(join(f.home, ".local")), false);
});

test("CLI report project validates selectors before storage without leaking IDs", () => {
  const f = fixture();
  for (const flags of [
    ["--project"],
    ["--project", ""],
    ["--project", "PRIVATE_SENTINEL", "--project", "other"],
    ["--project", "x".repeat(65)],
    ["--project", " Repo_1"],
    ["--project", "Repo_1 "],
    ["--project", "Repo.1"],
    ["--project", "é"],
    ["--project", "Repo_1\n"],
    ["--project", "--literal"],
    ["--project=Repo_1"],
    ["--project", "PRIVATE_SENTINEL", "--session", "s"],
    ["--session", "s", "--project", "PRIVATE_SENTINEL"],
    ["--help", "--project", "bad/id"],
  ]) {
    const result = f.run("report", "--db", f.db, ...flags);
    assert.equal(result.status, 2, JSON.stringify(flags));
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "Invalid arguments. Use --help.\n");
    assert.equal(existsSync(join(f.dir, "db")), false);
  }
  for (const command of ["import", "costs"]) {
    const result = f.run(command, "--db", f.db, "--project", "Repo_1");
    assert.equal(result.status, 2);
    assert.equal(existsSync(join(f.dir, "db")), false);
  }
  const help = f.run("report", "--help");
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--project id/);
  assert.match(help.stdout, /ASCII.*1.*64/);
  assert.match(help.stdout, /mutually exclusive/);
  const missing = f.run("report", "--db", f.db, "--project", "Repo_1");
  assert.equal(missing.status, 1);
  assert.equal(missing.stderr, "Report failed. Check database access.\n");
  assert.equal(existsSync(join(f.dir, "db")), false);
  assert.equal(existsSync(join(f.home, ".local")), false);
});

test("CLI report project delegates literal selection across synthetic worktrees", () => {
  const f = fixture();
  const ids = ["Repo_1", "repo_1", "Z".repeat(64), "_"];
  const sources = [
    ["worktree-a", "a", ids[0]],
    ["worktree-b", "b", ids[0]],
    ["case", "case", ids[1]],
    ["limit", "limit", ids[2]],
    ["minimum", "minimum", ids[3]],
    ["unmapped", "unmapped", null],
    ["alias-a", "ambiguous", ids[0]],
    ["alias-b", "ambiguous", ids[0]],
    ["external", "parent", ids[1]],
  ];
  const paths = sources.map(([name, id], index) => {
    const row = message(id === "parent" ? "copy" : "one");
    row.message.model = `fixture-${index}`;
    if (index === 0) row.message.usage.cost = { total: 0 };
    return f.file(`${name}.jsonl`, [header(id), row]);
  });
  const copied = message("copy");
  copied.message.model = "fixture-8";
  const child = f.file("child.jsonl", [
    header("child", { parentSession: paths[8] }),
    copied,
    message("unresolved"),
  ]);
  const ledger = openLedger(f.db);
  try {
    ledger.importFiles({
      sessions: [...paths, child],
      projectMappings: [
        ...sources.flatMap(([, , projectId], index) =>
          projectId ? [{ sessionPath: paths[index], projectId }] : [],
        ),
        { sessionPath: child, projectId: ids[0] },
      ],
    });
  } finally {
    ledger.close();
  }
  const reopened = openLedger(f.db);
  try {
    for (const projectId of [...ids, "unknown"]) {
      const actual = json(
        f.run("report", "--db", f.db, "--project", projectId),
      );
      assert.deepEqual(actual, reopened.runtimeReport({ projectId }));
      assert.equal(
        actual.coverage.includedEntries,
        projectId === ids[0] || projectId === ids[1]
          ? 2
          : projectId === "unknown"
            ? 0
            : 1,
      );
      assert.equal(actual.runtime.total, null);
      assert.equal(actual.runtime.currency, null);
    }
    const selected = json(f.run("report", "--db", f.db, "--project", ids[0]));
    assert.deepEqual(selected.coverage.excludedByCertainty, {
      copied: 1,
      "lineage-unresolved": 1,
    });
    assert.equal(selected.runtime.coverage.recordedEntries, 1);
    assert.equal(selected.runtime.coverage.missingEntries, 1);
    assert.equal(selected.runtime.observations[0].amount, 0);
    assert.deepEqual(
      json(f.run("report", "--db", f.db)),
      reopened.runtimeReport({}),
    );
    assert.deepEqual(
      json(f.run("report", "--db", f.db, "--session", "unmapped")),
      reopened.runtimeReport({ session: "unmapped" }),
    );
  } finally {
    reopened.close();
  }
  const corrupt = f.file("PRIVATE_SENTINEL.sqlite", [{ invalid: true }]);
  const failed = f.run(
    "report",
    "--db",
    corrupt,
    "--project",
    "PRIVATE_SENTINEL",
  );
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout, "");
  assert.match(failed.stderr, /^Report failed\. Check database access\.\n/);
  assert.equal(failed.stderr.includes("PRIVATE_SENTINEL"), false);
  assert.equal(failed.stderr.includes(f.dir), false);
  assert.equal(existsSync(join(f.home, ".local")), false);
});

test("CLI report session retains external parent classification before selection", () => {
  const f = fixture();
  const parent = f.file("parent.jsonl", [header("parent"), message("copy")]);
  const child = f.file("child.jsonl", [
    header("child", { parentSession: parent }),
    message("copy"),
    message("unresolved"),
  ]);
  json(f.run("import", "--db", f.db, "--session", parent, "--session", child));
  const ledger = openLedger(f.db);
  try {
    const selected = json(f.run("report", "--db", f.db, "--session", "child"));
    assert.deepEqual(selected, ledger.runtimeReport({ session: "child" }));
    assert.deepEqual(selected.coverage, {
      includedEntries: 0,
      excludedEntries: 2,
      excludedByCertainty: { copied: 1, "lineage-unresolved": 1 },
    });
    assert.deepEqual(selected.agents, []);
    assert.deepEqual(selected.models, []);
    assert.deepEqual(selected.runtime.observations, []);
    assert.equal(selected.runtime.coverage.missingEntries, 0);
    assert.equal(
      json(f.run("report", "--db", f.db)).coverage.includedEntries,
      1,
    );
  } finally {
    ledger.close();
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
