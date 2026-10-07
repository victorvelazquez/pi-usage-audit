import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
function seeded() {
  const ledger = openLedger(":memory:");
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
    const demo = projectDemo(
      ledger.runtimeReport({}),
      ledger.costReport({ currency: "EUR" }),
    );
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
    );
    assert.ok(renderDashboard(empty).includes("Sin filas"));
    assert.equal(empty.runtime.total, null);
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

const cli = (args) =>
  spawnSync(process.execPath, ["src/dashboard.js", ...args], {
    encoding: "utf8",
  });
test("CLI help and invalid requests are sanitized before startup", () => {
  const help = cli(["--help"]);
  assert.equal(help.status, 0);
  assert.ok(help.stdout.includes("--demo"));
  for (const args of [
    [],
    ["--db", "PRIVATE_PATH"],
    ["--host", "0.0.0.0"],
    ["--demo", "--demo"],
    ["--help", "--demo"],
    ["--demo", "--port", "-1"],
    ["--demo", "--port", "65536"],
    ["--demo", "--port"],
    ["--demo", "--port", "0", "--port", "1"],
  ]) {
    const result = cli(args);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.ok(!result.stderr.includes("PRIVATE_PATH"));
  }
});

test("CLI effective URL, occupied port and signal shutdown", async () => {
  for (const requestedSignal of ["SIGINT", "SIGTERM"]) {
    const child = spawn(process.execPath, ["src/dashboard.js", "--demo"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exited = once(child, "exit");
    try {
      const [chunk] = await once(child.stdout, "data");
      const url = chunk.toString().trim();
      assert.match(url, /^http:\/\/127\.0\.0\.1:[1-9]\d*\/$/);
      const port = Number(new URL(url).port);
      assert.equal((await request(port)).status, 200);
      const busy = cli(["--demo", "--port", String(port)]);
      assert.equal(busy.status, 1);
      assert.equal(busy.stderr.trim(), "Demo unavailable");
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
