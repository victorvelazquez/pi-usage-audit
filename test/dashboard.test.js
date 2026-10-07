import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as dashboard from "../src/dashboard.js";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import { openLedger } from "../src/ledger.js";
import { projectDemo, renderDashboard } from "../src/dashboard-report.js";
import { startDemo } from "../src/dashboard.js";

const fixture = () =>
  JSON.parse(
    readFileSync(new URL("./fixtures/dashboard-demo.json", import.meta.url)),
  );
const categories = ["input", "output", "cacheRead", "cacheWrite"];
function seeded(path = ":memory:") {
  const ledger = openLedger(path);
  for (const [session, agent, provider, model, input, certainty] of [
    ["a", "<demo>", "synthetic", "priced", Number.MAX_SAFE_INTEGER, "own"],
    ["b", "<demo>", "synthetic", "priced", Number.MAX_SAFE_INTEGER, "own"],
    ["c", "zero", "synthetic", "zero", 0, "own"],
    ["d", "unknown", "synthetic", "unpriced", 2, "own"],
    ["e", "unknown", null, null, 1, "own"],
    ["f", "unknown", "synthetic", "excluded", 9, "incomplete"],
  ]) {
    ledger.db
      .prepare("INSERT INTO sources VALUES (?,?,NULL)")
      .run(session, session);
    ledger.db
      .prepare("INSERT INTO tasks VALUES (?,?,?,NULL,NULL,NULL)")
      .run(session, session, agent);
    ledger.db.prepare("INSERT INTO entries VALUES (?,?,?,?,0)").run(
      session,
      "PRIVATE_ID",
      JSON.stringify({
        provider,
        model,
        input,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: input,
        certainty,
        operation: "assistant",
        timestamp: "2026-01-01T00:00:00.000Z",
        runtimeEstimate: session === "c" ? 0 : null,
      }),
      "synthetic",
    );
  }
  for (const model of ["priced", "zero"]) {
    for (const category of categories)
      ledger.addManualPrice({
        provider: "synthetic",
        model,
        category,
        currency: "EUR",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        ratePerMillion: model === "zero" ? "0" : "1",
      });
  }
  return ledger;
}

test("fixture equals projection of immutable synthetic API reports", () => {
  const ledger = seeded();
  try {
    const before = ledger.db.prepare("SELECT * FROM entries").all();
    const demo = projection(ledger);
    assert.deepEqual(demo, fixture());
    assert.deepEqual(ledger.db.prepare("SELECT * FROM entries").all(), before);
    const html = renderDashboard(demo);
    for (const value of [
      "18014398509481982",
      "18014398509.481982000000",
      "0.000000000000",
      "invalid-provider",
      "missingPrices",
      "incomplete",
      "Desconocido",
      "EUR",
    ]) {
      assert.ok(html.includes(value), value);
    }
    assert.match(html, /<caption>Evolución diaria — UTC<\/caption>/);
    assert.match(
      html,
      /<td>2026-01-01<\/td><td>5<\/td><td>18014398509481985<\/td>/,
    );
    assert.ok(!html.includes("PRIVATE_ID"));
    assert.ok(!JSON.stringify(demo).includes("PRIVATE_ID"));
    assert.ok(html.includes("&lt;demo&gt;"));
    assert.ok(!html.includes("<demo>"));
  } finally {
    ledger.close();
  }
});

test("empty reports and escaping preserve unknown, zero and exact strings", () => {
  const ledger = openLedger(":memory:");
  try {
    const empty = projectDemo(
      ledger.runtimeReport({}),
      ledger.costReport({ currency: "EUR" }),
      ledger.tokenEvolution({}),
    );
    assert.ok(renderDashboard(empty).includes("Sin filas"));
    assert.equal(empty.runtime.total, null);
    assert.deepEqual(empty.evolution.buckets, []);
    assert.match(renderDashboard(empty), /Sin fecha.*<td>0<\/td><td>0<\/td>/s);
    const demo = fixture();
    demo.agents[0].agent = `<script>&"'`;
    const html = renderDashboard(demo);
    assert.ok(html.includes("&lt;script&gt;&amp;&quot;&#39;"));
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("runtime-currency-not-recorded"));
    assert.ok(!html.includes("USD"));
  } finally {
    ledger.close();
  }
});

function retime(ledger, session, timestamp) {
  ledger.db
    .prepare(
      "UPDATE entries SET data=json_set(data, '$.timestamp', ?) WHERE session=?",
    )
    .run(timestamp, session);
}
function projection(ledger) {
  return projectDemo(
    ledger.runtimeReport({}),
    ledger.costReport({ currency: "EUR" }),
    ledger.tokenEvolution({}),
  );
}

test("daily evolution preserves observed UTC days, gaps, zero and coverage", () => {
  const ledger = seeded();
  try {
    retime(ledger, "a", "2026-01-03T23:59:59.999Z");
    retime(ledger, "b", "2026-01-03T00:00:00.000Z");
    retime(ledger, "c", "2026-01-05T00:00:00.000Z");
    retime(ledger, "f", "invalid-excluded-date");
    const demo = projection(ledger);
    assert.deepEqual(demo.evolution.buckets, [
      { day: "2026-01-01", entries: 2, totalTokens: "3" },
      { day: "2026-01-03", entries: 2, totalTokens: "18014398509481982" },
      { day: "2026-01-05", entries: 1, totalTokens: "0" },
    ]);
    assert.deepEqual(demo.evolution.coverage, demo.coverage);
    const html = renderDashboard(demo);
    assert.ok(!html.includes("2026-01-02"));
    assert.ok(!html.includes("2026-01-04"));
    assert.match(html, /<td>2026-01-05<\/td><td>1<\/td><td>0<\/td>/);
    assert.ok(html.includes("18014398509481982"));
    assert.ok(!/1\.8014|18\.01|18M/.test(html));
    assert.ok(html.includes("Excluidas de evolución (no son cero): 1"));
    assert.ok(html.includes("incomplete"));
  } finally {
    ledger.close();
  }
});

test("only undated evolution distinguishes missing and invalid timestamps", () => {
  const ledger = seeded();
  try {
    for (const session of ["a", "b"]) retime(ledger, session, null);
    for (const session of ["c", "d", "e"])
      retime(ledger, session, "2026-01-01T00:00:00+00:00");
    const demo = projection(ledger);
    assert.deepEqual(demo.evolution.buckets, []);
    assert.deepEqual(demo.evolution.undated, {
      entries: 5,
      totalTokens: "18014398509481985",
      missingTimestampEntries: 2,
      invalidTimestampEntries: 3,
    });
    const html = renderDashboard(demo);
    assert.match(
      html,
      /Sin fecha.*<td>5<\/td><td>18014398509481985<\/td><td>2<\/td><td>3<\/td>/s,
    );
    assert.ok(html.includes("Sin filas"));
    assert.ok(html.includes("vistas no aditivas"));
  } finally {
    ledger.close();
  }
});

test("evolution projection deeply detaches summaries and escapes every value", () => {
  const ledger = seeded();
  try {
    const snapshot = {
      runtime: ledger.runtimeReport({}),
      costs: ledger.costReport({ currency: "EUR" }),
      evolution: ledger.tokenEvolution({}),
    };
    const before = structuredClone(snapshot.evolution);
    const demo = projectDemo(
      snapshot.runtime,
      snapshot.costs,
      snapshot.evolution,
    );
    demo.evolution.buckets[0].day = `<script>&"'`;
    demo.evolution.undated.totalTokens = "<undated>";
    demo.evolution.coverage.excludedByCertainty.incomplete = "<excluded>";
    const html = renderDashboard(demo);
    assert.ok(html.includes("&lt;script&gt;&amp;&quot;&#39;"));
    assert.ok(html.includes("&lt;undated&gt;"));
    assert.ok(html.includes("&lt;excluded&gt;"));
    assert.ok(!html.includes("<script"));
    assert.deepEqual(snapshot.evolution, before);
    assert.ok(
      !/<script|<canvas|<svg|<input|<select/.test(renderDashboard(fixture())),
    );
  } finally {
    ledger.close();
  }
});

function request(port, path = "/", options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path, ...options },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (part) => {
          body += part;
        });
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, body }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("HTTP loopback, exact route, headers and origin boundaries", async () => {
  const server = await startDemo(0);
  const port = server.address().port;
  try {
    assert.equal(server.address().address, "127.0.0.1");
    const ok = await request(port);
    assert.equal(ok.status, 200);
    assert.ok(ok.body.includes("DEMO — datos sintéticos, sin captura"));
    assert.equal(ok.headers["cache-control"], "no-store");
    assert.equal(ok.headers["x-content-type-options"], "nosniff");
    assert.equal(ok.headers["referrer-policy"], "no-referrer");
    for (const directive of [
      "script-src 'none'",
      "connect-src 'none'",
      "frame-src 'none'",
      "frame-ancestors 'none'",
      "style-src 'unsafe-inline'",
    ]) {
      assert.ok(ok.headers["content-security-policy"].includes(directive));
    }
    for (const path of ["/?x=1", "/favicon.ico", "/other"])
      assert.equal((await request(port, path)).status, 404);
    for (const method of ["POST", "HEAD", "OPTIONS"])
      assert.equal((await request(port, "/", { method })).status, 405);
    for (const headers of [
      { Host: "localhost:" + port },
      { Host: "evil.test" },
      { Origin: "http://evil.test" },
      { Origin: "null" },
      { "Sec-Fetch-Site": "cross-site" },
      { "Sec-Fetch-Site": "same-site" },
    ]) {
      const denied = await request(port, "/", { headers });
      assert.equal(denied.status, 403);
      assert.ok(!denied.body.includes("evil.test"));
    }
    assert.equal(
      (
        await request(port, "/", {
          headers: {
            Origin: `http://127.0.0.1:${port}`,
            "Sec-Fetch-Site": "same-origin",
          },
        })
      ).status,
      200,
    );
    await assert.rejects(startDemo(port));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("selected database snapshot closes before listen and stays static", async (t) => {
  const dir = mkdtempSync("test/.runtime-dashboard-");
  const path = join(dir, "synthetic.sqlite");
  const ledger = seeded(path);
  ledger.close();
  const before = readFileSync(path);
  let closes = 0;
  const close = DatabaseSync.prototype.close;
  const listen = http.Server.prototype.listen;
  t.mock.method(DatabaseSync.prototype, "close", function () {
    closes++;
    return close.call(this);
  });
  t.mock.method(http.Server.prototype, "listen", function (...args) {
    assert.equal(closes, 1);
    return listen.apply(this, args);
  });
  const server = await dashboard.startDashboard({ db: path, currency: "EUR" });
  t.mock.restoreAll();
  try {
    assert.deepEqual(readFileSync(path), before);
    const port = server.address().port;
    const page = await request(port);
    assert.equal(page.status, 200);
    assert.equal(page.body, renderDashboard(fixture(), { selected: true }));
    assert.ok(page.body.includes("BASE SELECCIONADA"));
    assert.ok(!page.body.includes("Snapshot sintético"));
    assert.ok(!page.body.includes(path));
    assert.ok(!page.body.includes("PRIVATE_ID"));
    assert.ok(page.body.includes("18014398509.481982000000"));
    assert.ok(page.body.includes("Desconocido (null)"));
    assert.ok(page.body.includes("0.000000000000"));
    assert.ok(page.body.includes("vistas no aditivas"));
    const writer = openLedger(path);
    try {
      writer.db.exec("UPDATE tasks SET agent='later-synthetic-agent'");
      writer.db.exec(`UPDATE entries SET data = json_set(data,
        '$.timestamp', '2026-02-01T00:00:00.000Z', '$.input', 7, '$.totalTokens', 7)`);
    } finally {
      writer.close();
    }
    assert.equal((await request(port)).body, page.body);
    assert.ok(!page.body.includes("later-synthetic-agent"));
    assert.equal((await request(port, "/?refresh=1")).status, 404);
    assert.equal(
      (await request(port, "/", { headers: { Host: "evil.test" } })).status,
      403,
    );
    await assert.rejects(
      dashboard.startDashboard({ db: path, currency: "EUR", port }),
      { message: "Dashboard unavailable" },
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("database failures close the snapshot and sanitize private errors", async (t) => {
  const dir = mkdtempSync("test/.runtime-dashboard-");
  const path = join(dir, "PRIVATE_PATH.sqlite");
  const ledger = seeded(path);
  ledger.close();
  let closes = 0;
  const close = DatabaseSync.prototype.close;
  t.mock.method(DatabaseSync.prototype, "close", function () {
    closes++;
    return close.call(this);
  });
  t.mock.method(DatabaseSync.prototype, "prepare", () => {
    throw new Error(path);
  });
  await assert.rejects(
    dashboard.startDashboard({ db: path, currency: "EUR" }),
    {
      message: "Dashboard unavailable",
    },
  );
  assert.equal(closes, 1);
  t.mock.restoreAll();
  closes = 0;
  let begins = 0;
  const exec = DatabaseSync.prototype.exec;
  t.mock.method(DatabaseSync.prototype, "close", function () {
    closes++;
    return close.call(this);
  });
  t.mock.method(DatabaseSync.prototype, "exec", function (sql) {
    if (sql === "BEGIN DEFERRED" && ++begins === 2) throw new Error(path);
    return exec.call(this, sql);
  });
  t.mock.method(http.Server.prototype, "listen", () =>
    assert.fail("must not listen"),
  );
  await assert.rejects(
    dashboard.startDashboard({ db: path, currency: "EUR" }),
    {
      message: "Dashboard unavailable",
    },
  );
  assert.equal(begins, 2);
  assert.equal(closes, 1);
  t.mock.restoreAll();
  const missing = join(dir, "missing.sqlite");
  const corrupt = join(dir, "corrupt.sqlite");
  writeFileSync(corrupt, "synthetic non SQLite");
  for (const db of [missing, corrupt]) {
    const result = cli(["--db", db, "--currency", "EUR"]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("Dashboard unavailable"));
    assert.ok(!result.stderr.includes(dir));
  }
  assert.equal(existsSync(missing), false);
});

const cli = (args) =>
  spawnSync(process.execPath, ["src/dashboard.js", ...args], {
    encoding: "utf8",
  });
test("CLI help and invalid requests are sanitized before startup", () => {
  const help = cli(["--help"]);
  assert.equal(help.status, 0);
  assert.ok(help.stdout.includes("--demo"));
  assert.ok(help.stdout.includes("--db FILE --currency CODE"));
  const dir = mkdtempSync("test/.runtime-dashboard-");
  const missing = join(dir, "PRIVATE_PATH.sqlite");
  for (const args of [
    [],
    ["--db", "PRIVATE_PATH"],
    ["--currency", "EUR"],
    ["--db", "PRIVATE_PATH", "--currency"],
    ["--db", "--currency", "EUR"],
    ["--db", "PRIVATE_PATH", "--currency", "eur"],
    ["--db", "PRIVATE_PATH", "--currency", "EUR", "--db", "other"],
    ["--db", "PRIVATE_PATH", "--currency", "EUR", "--currency", "USD"],
    ["--demo", "--db", "PRIVATE_PATH", "--currency", "EUR"],
    ["--demo", "--currency", "EUR"],
    ["--host", "0.0.0.0"],
    ["--demo", "--demo"],
    ["--help", "--demo"],
    ["--demo", "--port", "-1"],
    ["--demo", "--port", "65536"],
    ["--demo", "--port"],
    ["--demo", "--port", "0", "--port", "1"],
  ]) {
    const result = cli(
      args.map((arg) => (arg === "PRIVATE_PATH" ? missing : arg)),
    );
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.ok(!result.stderr.includes("PRIVATE_PATH"));
    assert.equal(existsSync(missing), false);
  }
});

test("CLI effective URL, occupied port and signal shutdown", async () => {
  const dir = mkdtempSync("test/.runtime-dashboard-");
  const path = join(dir, "synthetic.sqlite");
  seeded(path).close();
  for (const [requestedSignal, args, banner, error] of [
    ["SIGINT", ["--demo"], "DEMO", "Demo unavailable"],
    ["SIGTERM", ["--demo"], "DEMO", "Demo unavailable"],
    [
      "SIGTERM",
      ["--db", path, "--currency", "EUR"],
      "BASE SELECCIONADA",
      "Dashboard unavailable",
    ],
  ]) {
    const child = spawn(process.execPath, ["src/dashboard.js", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exited = once(child, "exit");
    try {
      const [chunk] = await once(child.stdout, "data");
      const url = chunk.toString().trim();
      assert.match(url, /^http:\/\/127\.0\.0\.1:[1-9]\d*\/$/);
      const port = Number(new URL(url).port);
      const page = await request(port);
      assert.equal(page.status, 200);
      assert.ok(page.body.includes(banner));
      assert.match(page.body, /<caption>Evolución diaria — UTC<\/caption>/);
      assert.ok(page.body.includes("18014398509481985"));
      assert.ok(!page.body.includes("<script"));
      const busy = cli([...args, "--port", String(port)]);
      assert.equal(busy.status, 1);
      assert.ok(busy.stderr.trim().endsWith(error));
      assert.ok(!busy.stderr.includes(path));
      child.kill(requestedSignal);
      const [code, signal] = await exited;
      // Windows terminates directly; POSIX exercises the graceful handler.
      assert.ok(code === 0 || signal === requestedSignal);
      await assert.rejects(request(port));
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
  }
});
