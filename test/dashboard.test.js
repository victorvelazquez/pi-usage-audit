import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as dashboard from "../src/dashboard.js";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { PassThrough } from "node:stream";
import * as ledgerModule from "../src/ledger.js";
import { openLedger } from "../src/ledger.js";
import { projectDemo, renderDashboard } from "../src/dashboard-report.js";
import { startDemo } from "../src/dashboard.js";

test("session filter fresh joint reports, admission and atomic failures", async (t) => {
  const path = join(
    mkdtempSync("test/.runtime-dashboard-"),
    "synthetic.sqlite",
  );
  const writer = seeded(path);
  const literal = " 私😀e\u0301 ";
  for (const table of ["sources", "entries"])
    writer.db
      .prepare(`UPDATE ${table} SET session=? WHERE session='a'`)
      .run(literal);
  writer.close();
  for (const allowManualPrices of [false, true]) {
    const server = await dashboard.startDashboard({
      db: path,
      currency: "EUR",
      allowManualPrices,
    });
    try {
      const port = server.address().port;
      const startup = await request(port);
      assert.ok(startup.body.includes('id="session-filter-form"'));
      let storageCalls = 0;
      for (const method of ["prepare", "exec", "close"])
        t.mock.method(DatabaseSync.prototype, method, () => {
          storageCalls++;
          throw new Error("PRIVATE_STORAGE_FAILURE");
        });
      for (const selector of [
        { projectId: " x" },
        { projectId: null },
        { projectId: "x", session: "a" },
        { projectId: "x", extra: "PRIVATE_ID" },
      ])
        await assert.rejects(
          postPrice(port, selector, { path: "/session-filter" }),
          { code: "ECONNRESET" },
        );
      assert.equal(
        storageCalls,
        0,
        "invalid HTTP selectors reject before storage",
      );
      t.mock.restoreAll();
      assert.equal((await request(port)).body, startup.body);
      for (const session of [
        undefined,
        literal,
        literal.trim(),
        " ",
        "absent",
      ]) {
        const selector = session === undefined ? {} : { session };
        const reader = ledgerModule.openReadonlyLedger(path);
        const snapshot = reader.dashboardReport({
          currency: "EUR",
          ...selector,
        });
        reader.close();
        const expected = renderDashboard(
          projectDemo(snapshot.runtime, snapshot.costs, snapshot.evolution),
          {
            selected: true,
            sessionSelected: session !== undefined,
            allowManualPrices,
          },
        );
        const response = await postPrice(port, selector, {
          path: "/session-filter",
        });
        assert.equal(response.status, 200);
        assert.equal(response.body, expected);
        assert.ok(!response.body.includes(literal));
        assert.equal((await request(port)).body, startup.body);
      }
      let closes = 0;
      const close = DatabaseSync.prototype.close;
      t.mock.method(DatabaseSync.prototype, "close", function () {
        closes++;
        return close.call(this);
      });
      await assert.rejects(
        postPrice(
          port,
          {},
          {
            path: "/session-filter",
            headers: { Origin: "http://evil.test" },
          },
        ),
      );
      assert.equal(closes, 0);
      const end = http.ServerResponse.prototype.end;
      t.mock.method(http.ServerResponse.prototype, "end", function (...args) {
        assert.equal(closes, 1, "readonly must close before reply");
        return end.apply(this, args);
      });
      assert.equal(
        (await postPrice(port, {}, { path: "/session-filter" })).status,
        200,
      );
      t.mock.restoreAll();
      t.mock.method(DatabaseSync.prototype, "close", function () {
        closes++;
        return close.call(this);
      });
      assert.equal(closes, 1);
      t.mock.method(DatabaseSync.prototype, "prepare", () => {
        throw new Error(literal + path);
      });
      const failed = await postPrice(port, {}, { path: "/session-filter" });
      assert.equal(failed.status, 500);
      assert.equal(failed.body, "Session filter operation failed");
      assert.equal(closes, 2);
      t.mock.restoreAll();
      t.mock.method(DatabaseSync.prototype, "close", function () {
        close.call(this);
        throw new Error(literal + path);
      });
      assert.equal(
        (await postPrice(port, {}, { path: "/session-filter" })).body,
        "Session filter operation failed",
      );
      t.mock.restoreAll();
      const later = openLedger(path);
      later.db.exec("UPDATE tasks SET agent='fresh-synthetic-agent'");
      const imported = allowManualPrices ? "new-opt" : "new-read";
      later.db
        .prepare("INSERT INTO sources VALUES (?,?,NULL)")
        .run(imported, imported);
      later.db
        .prepare(`INSERT INTO entries SELECT ?, entry, data, evidence, conflict
          FROM entries WHERE session='d'`)
        .run(imported);
      for (const category of categories)
        later.addManualPrice({
          ...priceValue,
          model: "unpriced",
          category,
          ratePerMillion: "3",
        });
      later.close();
      const fresh = await postPrice(port, {}, { path: "/session-filter" });
      assert.ok(fresh.body.includes("fresh-synthetic-agent"));
      const reader = ledgerModule.openReadonlyLedger(path);
      const snapshot = reader.dashboardReport({ currency: "EUR" });
      reader.close();
      assert.equal(
        fresh.body,
        renderDashboard(
          projectDemo(snapshot.runtime, snapshot.costs, snapshot.evolution),
          { selected: true, allowManualPrices },
        ),
      );
      assert.equal((await request(port)).body, startup.body);
      if (allowManualPrices) assert.equal((await postPrice(port)).status, 200);
    } finally {
      t.mock.restoreAll();
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

test("session filter project HTTP joint scope literal freshness and privacy", async (t) => {
  const path = join(
    mkdtempSync("test/.runtime-dashboard-"),
    "synthetic.sqlite",
  );
  const literal = "Private_Project-1";
  const writer = seeded(path);
  for (const session of ["a", "c", "d", "e", "f"])
    writer.db
      .prepare("INSERT INTO project_mappings VALUES (?,?)")
      .run(session, literal);
  writer.db
    .prepare("INSERT INTO project_mappings VALUES (?,?)")
    .run("b", "Other");
  writer.close();
  const expected = (selector, allowManualPrices) => {
    const reader = ledgerModule.openReadonlyLedger(path);
    try {
      const snapshot = reader.dashboardReport({
        currency: "EUR",
        ...selector,
      });
      return renderDashboard(
        projectDemo(snapshot.runtime, snapshot.costs, snapshot.evolution),
        {
          selected: true,
          projectSelected: selector.projectId !== undefined,
          sessionSelected: selector.session !== undefined,
          allowManualPrices,
        },
      );
    } finally {
      reader.close();
    }
  };
  for (const allowManualPrices of [false, true]) {
    const server = await dashboard.startDashboard({
      db: path,
      currency: "EUR",
      session: "b",
      allowManualPrices,
    });
    try {
      const port = server.address().port;
      assert.equal(server.address().address, "127.0.0.1");
      const startup = await request(port);
      const before = readFileSync(path);
      for (const selector of [
        { projectId: literal },
        { projectId: literal.toLowerCase() },
        { projectId: "absent" },
        { projectId: "x".repeat(64) },
        { projectId: "_-0" },
        {},
        { session: "b" },
        { projectId: literal },
      ]) {
        const html = expected(selector, allowManualPrices);
        let closes = 0;
        const close = DatabaseSync.prototype.close;
        t.mock.method(DatabaseSync.prototype, "close", function () {
          closes++;
          return close.call(this);
        });
        const end = http.ServerResponse.prototype.end;
        t.mock.method(http.ServerResponse.prototype, "end", function (...args) {
          assert.equal(closes, 1, "readonly closed before HTTP reply");
          return end.apply(this, args);
        });
        const response = await postPrice(port, selector, {
          path: "/session-filter",
        });
        t.mock.restoreAll();
        assert.equal(response.status, 200);
        assert.equal(response.body, html);
        for (const key of [
          "content-type",
          "cache-control",
          "x-content-type-options",
          "referrer-policy",
          "content-security-policy",
        ])
          assert.equal(response.headers[key], startup.headers[key]);
        assert.ok(!response.body.includes(literal));
        assert.ok(!response.body.includes(path));
        assert.ok(!response.body.includes("PRIVATE_ID"));
        if (selector.projectId === literal) {
          assert.match(html, /Proyecto seleccionado/);
          assert.ok(html.includes("9007199254740991"));
          assert.ok(html.includes("9007199254.740991000000"));
          assert.ok(html.includes("0.000000000000"));
          assert.ok(html.includes("missingPrices"));
          assert.ok(html.includes("Desconocido (null)"));
          assert.match(html, /<caption>Evolución diaria — UTC<\/caption>/);
          assert.match(html, /<details><summary>&lt;demo&gt;<\/summary>/);
        } else if (selector.projectId !== undefined) {
          assert.match(html, /Proyecto seleccionado/);
          assert.ok(html.includes("Sin filas"));
          assert.ok(!html.includes("<details>"));
        }
        assert.equal((await request(port)).body, startup.body);
      }
      assert.deepEqual(
        readFileSync(path),
        before,
        "filters never write the base",
      );
      let storageCalls = 0;
      for (const method of ["prepare", "exec", "close"])
        t.mock.method(DatabaseSync.prototype, method, () => {
          storageCalls++;
          throw new Error(literal + path);
        });
      for (const options of [
        { headers: { Origin: "null" } },
        { headers: { Host: "localhost:" + port } },
        { headers: { "Sec-Fetch-Site": "cross-site" } },
        { headers: { "Content-Type": "text/plain" } },
        { headers: { "Content-Encoding": "gzip" } },
        {
          body: JSON.stringify({ projectId: literal }) + " ".repeat(8192),
        },
        { body: '{"projectId":"x","__proto__":{}}' },
        { body: JSON.stringify({ session: "b", projectId: literal }) },
      ])
        await assert.rejects(
          postPrice(
            port,
            { projectId: literal },
            {
              path: "/session-filter",
              ...options,
            },
          ),
          { code: "ECONNRESET" },
        );
      assert.equal(storageCalls, 0);
      t.mock.restoreAll();
      for (const mode of ["read", "close"]) {
        let closes = 0;
        const close = DatabaseSync.prototype.close;
        t.mock.method(DatabaseSync.prototype, "close", function () {
          closes++;
          close.call(this);
          if (mode === "close") throw new Error(literal + path);
        });
        if (mode === "read")
          t.mock.method(DatabaseSync.prototype, "prepare", () => {
            throw new Error(literal + path);
          });
        const failed = await postPrice(
          port,
          { projectId: literal },
          {
            path: "/session-filter",
          },
        );
        assert.equal(failed.status, 500);
        assert.equal(failed.body, "Session filter operation failed");
        assert.equal(closes, 1);
        t.mock.restoreAll();
        assert.equal((await request(port)).body, startup.body);
      }
      const later = openLedger(path);
      later.db.exec(
        "UPDATE tasks SET agent='fresh-project-agent' WHERE id='d'",
      );
      later.close();
      if (allowManualPrices)
        for (const category of categories)
          assert.equal(
            (
              await postPrice(port, {
                ...priceValue,
                model: "unpriced",
                category,
              })
            ).status,
            200,
          );
      const fresh = await postPrice(
        port,
        { projectId: literal },
        {
          path: "/session-filter",
        },
      );
      assert.equal(
        fresh.body,
        expected({ projectId: literal }, allowManualPrices),
      );
      assert.ok(fresh.body.includes("fresh-project-agent"));
      assert.equal(fresh.body.includes("missingPrices"), !allowManualPrices);
      assert.equal((await request(port)).body, startup.body);
    } finally {
      t.mock.restoreAll();
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

test("session filter client literal payload, pending and atomic DOM validation", async () => {
  const { sessionFilterScript } = await import("../src/session-filter-form.js");
  const fields = {
    mode: { value: "session" },
    session: { value: " 私😀 " },
    projectId: { value: "Private_Project-1" },
    taskId: { value: "Private_Task-1" },
  };
  const button = {};
  const feedback = {};
  let submit, settle, parsed;
  let replacements = 0;
  const region = {
    replaceWith(node) {
      assert.equal(node, parsed);
      replacements++;
    },
  };
  const form = {
    elements: { namedItem: (key) => fields[key] },
    addEventListener(name, handler) {
      assert.equal(name, "submit");
      submit = handler;
    },
  };
  const calls = [];
  let outcome;
  runInNewContext(sessionFilterScript, {
    document: {
      getElementById: (id) =>
        ({
          "session-filter-form": form,
          "session-filter-submit": button,
          "session-filter-feedback": feedback,
          "dashboard-report": region,
        })[id],
    },
    DOMParser: class {
      parseFromString(body, type) {
        assert.equal(body, "synthetic HTML");
        assert.equal(type, "text/html");
        parsed = {
          querySelector: (selector) =>
            selector === "[data-dashboard-scope]"
              ? outcome === "scope"
                ? null
                : {}
              : outcome === "script"
                ? {}
                : null,
        };
        return {
          querySelectorAll: () =>
            outcome === "malformed"
              ? []
              : outcome === "duplicate"
                ? [parsed, parsed]
                : [parsed],
        };
      }
    },
    fetch(url, options) {
      calls.push({ url, options });
      return new Promise((resolve, reject) => {
        settle = { resolve, reject };
      });
    },
  });
  const accepted = [
    ...["x", "X", "Repo_1", "repo_1", "_-0", "x".repeat(64)].map(
      (projectId) => ({ projectId }),
    ),
    ...[" ", "x".repeat(512), "😀".repeat(256), " 私😀e\u0301 "].map(
      (session) => ({ session }),
    ),
  ];
  for (const selector of accepted) {
    const key = Object.keys(selector)[0];
    fields.mode.value = key === "projectId" ? "project" : "session";
    fields[key === "projectId" ? "session" : "projectId"].value = "";
    fields[key].value = selector[key];
    const pending = submit({ preventDefault() {} });
    assert.deepEqual(JSON.parse(calls.at(-1).options.body), selector);
    assert.ok(Object.values(fields).every((field) => field.disabled));
    settle.resolve({
      status: 200,
      headers: { get: () => "text/html" },
      text: async () => "synthetic HTML",
    });
    await pending;
    assert.ok(Object.values(fields).every((field) => !field.disabled));
    assert.equal(fields[key].value, selector[key]);
  }
  for (const [mode, key, values] of [
    [
      "project",
      "projectId",
      [
        "",
        "x".repeat(65),
        " x",
        "x ",
        "x\n",
        "a/b",
        "a.b",
        "é",
        "😀",
        "x\u0000",
      ],
    ],
    ["session", "session", ["", "x".repeat(513), "😀".repeat(257)]],
    ["unknown", "session", ["Private_Session"]],
    ["", "session", ["Private_Session"]],
  ]) {
    fields.mode.value = mode;
    for (const value of values) {
      fields[key].value = value;
      const count = calls.length;
      const before = replacements;
      await submit({ preventDefault() {} });
      assert.equal(calls.length, count);
      assert.equal(replacements, before);
      assert.ok(!feedback.textContent.includes("Private"));
      assert.equal(fields[key].value, value);
      assert.ok(Object.values(fields).every((field) => !field.disabled));
    }
  }
  for (outcome of [
    "success",
    "global",
    "empty",
    "malformed",
    "duplicate",
    "script",
    "scope",
    "type",
    "operation",
    "network",
    "body",
    "recovery",
  ]) {
    fields.mode.value =
      outcome === "global"
        ? "global"
        : ["success", "empty"].includes(outcome)
          ? "session"
          : "project";
    fields.projectId.value = outcome === "global" ? "" : "Private_Project-1";
    fields.session.value = ["empty", "global"].includes(outcome)
      ? ""
      : " 私😀 ";
    const previousInputs = [fields.session.value, fields.projectId.value];
    const count = calls.length;
    const before = replacements;
    const pending = submit({ preventDefault() {} });
    await submit({ preventDefault() {} });
    if (outcome === "empty") {
      assert.equal(calls.length, count);
      continue;
    }
    assert.equal(calls.length, count + 1);
    assert.equal(button.disabled, true);
    assert.ok(Object.values(fields).every((field) => field.disabled));
    assert.equal(calls.at(-1).url, "/session-filter");
    assert.equal(calls.at(-1).options.method, "POST");
    assert.deepEqual(
      JSON.parse(calls.at(-1).options.body),
      outcome === "global"
        ? {}
        : fields.mode.value === "session"
          ? { session: " 私😀 " }
          : { projectId: "Private_Project-1" },
    );
    if (outcome === "network") settle.reject(new Error("PRIVATE"));
    else
      settle.resolve({
        status: outcome === "operation" ? 500 : 200,
        headers: {
          get: () =>
            outcome === "type"
              ? "application/json"
              : "text/html; charset=utf-8",
        },
        text: async () => {
          if (outcome === "body") throw new Error("PRIVATE");
          return "synthetic HTML";
        },
      });
    await pending;
    assert.equal(
      replacements,
      before + (["success", "global", "recovery"].includes(outcome) ? 1 : 0),
    );
    assert.equal(button.disabled, false);
    assert.ok(Object.values(fields).every((field) => !field.disabled));
    assert.ok(!feedback.textContent.includes("PRIVATE"));
    assert.deepEqual(
      [fields.session.value, fields.projectId.value],
      previousInputs,
    );
  }
});

const priceOrigin = "http://127.0.0.1:1234";
const priceValue = {
  provider: "synthetic",
  model: "模型",
  category: "input",
  currency: "EUR",
  effectiveFrom: "2024-02-29T00:00:00.000Z",
  ratePerMillion: "1.200000",
};
function priceRequest(headers = {}, method = "POST", url = "/manual-prices") {
  const req = new PassThrough();
  req.method = method;
  req.url = url;
  req.rawHeaders = Object.entries({
    Host: "127.0.0.1:1234",
    Origin: priceOrigin,
    "Content-Type": "application/json",
    ...headers,
  }).flatMap(([key, value]) => (value === undefined ? [] : [key, value]));
  return req;
}
const priceError = (status) => ({
  name: "ManualPriceRequestError",
  status,
  message: "Manual price request rejected",
});

const sessionError = (status) => ({
  name: "SessionFilterRequestError",
  status,
  message: "Session filter request rejected",
});

function sessionRequest(
  headers = {},
  method = "POST",
  url = "/session-filter",
) {
  return priceRequest(headers, method, url);
}

async function parseSessionBody(body, headers = {}) {
  const req = sessionRequest(headers);
  const result = dashboard.parseSessionFilterRequest(req, priceOrigin);
  req.end(body);
  return result;
}

test("session filter HTTP accepts global and literal UTF16 selectors", async () => {
  assert.deepEqual(await parseSessionBody("{}"), {});
  for (const session of [
    " ",
    " Synthetic/Case ",
    "a\u0000b",
    "é",
    "e\u0301",
    "x".repeat(512),
    "😀".repeat(256),
  ]) {
    assert.deepEqual(await parseSessionBody(JSON.stringify({ session })), {
      session,
    });
  }
});

test("session filter project parser accepts literal ASCII before storage", async (t) => {
  let storageCalls = 0;
  for (const method of ["prepare", "exec", "close"])
    t.mock.method(DatabaseSync.prototype, method, () => {
      storageCalls++;
      throw new Error("PRIVATE_STORAGE_FAILURE");
    });
  for (const projectId of [
    "x",
    "X",
    "Repo_1",
    "repo_1",
    "_-0",
    "x".repeat(64),
  ]) {
    const req = sessionRequest();
    const result = dashboard.parseSessionFilterRequest(req, priceOrigin);
    req.end(JSON.stringify({ projectId }));
    assert.deepEqual(await result, { projectId });
    for (const event of ["data", "end", "aborted", "error", "close"])
      assert.equal(req.listenerCount(event), 0);
  }
  assert.deepEqual(await parseSessionBody("{}"), {});
  assert.deepEqual(await parseSessionBody('{"session":" 私😀 "}'), {
    session: " 私😀 ",
  });
  assert.equal(storageCalls, 0);
});

test("session filter project parser rejects types extras and mixed selectors", async (t) => {
  let storageCalls = 0;
  for (const method of ["prepare", "exec", "close"])
    t.mock.method(DatabaseSync.prototype, method, () => {
      storageCalls++;
      throw new Error("PRIVATE_STORAGE_FAILURE");
    });
  const invalid = [
    ...[
      "",
      "x".repeat(65),
      " x",
      "x ",
      "x\n",
      "a/b",
      "a.b",
      "é",
      "😀",
      "x\u0000",
      null,
      1,
      true,
      [],
      {},
    ].map((projectId) => ({ projectId })),
    { projectId: "x", session: "a" },
    { session: "a", projectId: "x" },
    { projectId: "x", session: null },
    { projectId: "x", extra: "PRIVATE_ID" },
    { projectId: "x", constructor: {} },
    { projectId: "x", toString: null },
    { project: "x" },
  ];
  const bodies = invalid.map((value) => JSON.stringify(value));
  bodies.push('{"projectId":"x","__proto__":{"polluted":true}}');
  for (const body of bodies) {
    const req = sessionRequest();
    const result = dashboard.parseSessionFilterRequest(req, priceOrigin);
    req.end(body);
    await assert.rejects(result, sessionError(400));
    assert.ok(req.destroyed);
    for (const event of ["data", "end", "aborted", "error", "close"])
      assert.equal(req.listenerCount(event), 0);
  }
  assert.equal(storageCalls, 0);
  assert.equal(Object.prototype.polluted, undefined);
});

test("session filter HTTP rejects shapes and hostile own keys without echo", async () => {
  for (const body of [
    "null",
    "[]",
    "1",
    "true",
    '"PRIVATE_ID"',
    '{"session":""}',
    '{"session":null}',
    '{"session":1}',
    '{"session":true}',
    '{"session":[]}',
    '{"session":{}}',
    JSON.stringify({ session: "x".repeat(513) }),
    JSON.stringify({ session: "😀".repeat(257) }),
    '{"extra":"PRIVATE_ID"}',
    '{"session":"PRIVATE_ID","extra":1}',
    '{"__proto__":{"session":"PRIVATE_ID"}}',
    '{"session":"PRIVATE_ID","constructor":{}}',
    '{"session":"PRIVATE_ID","toString":null}',
    "",
    "{",
    "{} trailing",
    "\ufeff{}",
  ]) {
    const req = sessionRequest();
    const result = dashboard.parseSessionFilterRequest(req, priceOrigin);
    req.end(body);
    await assert.rejects(result, sessionError(400));
    assert.ok(req.destroyed);
    for (const event of ["data", "end", "aborted", "error", "close"])
      assert.equal(req.listenerCount(event), 0);
  }
  assert.equal(Object.prototype.session, undefined);
});

test("session filter HTTP enforces admission and duplicate headers", async () => {
  for (const [headers, method, url, status] of [
    [{ Origin: undefined }, "POST", "/session-filter", 403],
    [{ Host: "localhost:1234" }, "POST", "/session-filter", 403],
    [{ Origin: "null" }, "POST", "/session-filter", 403],
    [{ "Sec-Fetch-Site": "same-site" }, "POST", "/session-filter", 403],
    [{}, "GET", "/session-filter", 405],
    [{}, "POST", "/session-filter?session=PRIVATE_ID", 404],
    [{}, "POST", "/manual-prices", 404],
    [{ "Content-Type": "text/plain" }, "POST", "/session-filter", 415],
    [{ "Content-Encoding": "gzip" }, "POST", "/session-filter", 415],
    [{ "Content-Length": "8193" }, "POST", "/session-filter", 413],
    [{ "Content-Length": "-1" }, "POST", "/session-filter", 400],
  ]) {
    const req = sessionRequest(headers, method, url);
    await assert.rejects(
      dashboard.parseSessionFilterRequest(req, priceOrigin),
      sessionError(status),
    );
    assert.ok(req.destroyed);
  }
  for (const key of [
    "Host",
    "Origin",
    "Content-Type",
    "Content-Length",
    "X-Extra",
  ]) {
    const req = sessionRequest();
    if (["Content-Length", "X-Extra"].includes(key))
      req.rawHeaders.push(key, "0");
    req.rawHeaders.push(key.toLowerCase(), "PRIVATE_ID");
    await assert.rejects(
      dashboard.parseSessionFilterRequest(req, priceOrigin),
      sessionError(400),
    );
  }
  await assert.rejects(
    dashboard.parseSessionFilterRequest(
      sessionRequest(),
      "http://localhost:1234",
    ),
    sessionError(403),
  );
});

test("session filter HTTP body limits, fatal UTF8 and deadline cleanup", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const clear = t.mock.method(globalThis, "clearTimeout");
  for (const mode of [
    "oversize",
    "utf8",
    "aborted",
    "error",
    "close",
    "timeout",
    "length",
  ]) {
    const req = sessionRequest(
      mode === "length" ? { "Content-Length": "1" } : {},
    );
    const result = dashboard.parseSessionFilterRequest(req, priceOrigin);
    const checked = assert.rejects(
      result,
      sessionError(mode === "oversize" ? 413 : mode === "timeout" ? 408 : 400),
    );
    if (mode === "timeout") {
      t.mock.timers.tick(4999);
      req.write(" ");
      t.mock.timers.tick(1);
    } else if (["aborted", "error", "close"].includes(mode)) {
      req.emit(mode, new Error("PRIVATE_ID"));
    } else {
      req.end(
        mode === "oversize"
          ? Buffer.alloc(8193, 32)
          : mode === "utf8"
            ? Buffer.from([0xc3, 0x28])
            : "{}",
      );
    }
    await checked;
    assert.ok(req.destroyed);
    assert.equal(clear.mock.callCount(), 1, mode);
    clear.mock.resetCalls();
    for (const event of ["data", "end", "aborted", "error", "close"])
      assert.equal(req.listenerCount(event), 0, `${mode}/${event}`);
    t.mock.timers.tick(5000);
  }
  assert.deepEqual(
    await parseSessionBody("{}" + " ".repeat(8190), {
      "Content-Length": "8192",
      "Content-Type": "application/json; charset=utf-8",
      "Content-Encoding": "identity",
      "Sec-Fetch-Site": "same-origin",
    }),
    {},
  );
  assert.equal(clear.mock.callCount(), 1);
});

test("session filter HTTP production demo remains inactive", async () => {
  const path = join(
    mkdtempSync("test/.runtime-dashboard-"),
    "synthetic.sqlite",
  );
  openLedger(path).close();
  for (const server of [await startDemo(0)]) {
    try {
      const port = server.address().port;
      assert.equal((await request(port, "/session-filter")).status, 404);
      assert.equal(
        (await request(port, "/session-filter", { method: "POST" })).status,
        405,
      );
      const page = await request(port);
      assert.ok(!page.body.includes("PRIVATE_ID"));
      assert.ok(!page.body.includes("/session-filter"));
      assert.match(
        page.headers["content-security-policy"],
        /connect-src 'none'/,
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

test("price HTTP manual semantics returns canonical six-field records", async () => {
  for (const [rate, canonical] of [
    ["0", "0.000000"],
    ["0.0", "0.000000"],
    ["1.2", "1.200000"],
    ["0.000001", "0.000001"],
    ["999999999999.999999", "999999999999.999999"],
  ]) {
    for (const category of ["input", "output", "cacheRead", "cacheWrite"]) {
      const value = { ...priceValue, category, ratePerMillion: rate };
      const req = priceRequest();
      const result = dashboard.parseManualPriceRequest(req, priceOrigin);
      req.end(JSON.stringify(value));
      assert.deepEqual(await result, { ...value, ratePerMillion: canonical });
    }
  }
  for (const effectiveFrom of [
    "0001-01-01T00:00:00.000Z",
    "9999-12-31T23:59:59.999Z",
  ]) {
    const value = {
      ...priceValue,
      provider: "Synthetic Provider",
      model: "模型/Case-sensitive",
      effectiveFrom,
    };
    const req = priceRequest();
    const result = dashboard.parseManualPriceRequest(req, priceOrigin);
    req.end(JSON.stringify(value));
    assert.deepEqual(await result, value);
  }
});

test("price HTTP manual semantics rejects shape, types and invalid field edges", async () => {
  const invalid = [null, [], 1, "PRIVATE_VALUE", true, {}];
  for (const key of Object.keys(priceValue)) {
    const missing = { ...priceValue };
    delete missing[key];
    invalid.push(missing);
    for (const value of [null, [], {}, 1, true])
      invalid.push({ ...priceValue, [key]: value });
  }
  invalid.push({ ...priceValue, extra: "PRIVATE_VALUE" });
  invalid.push(
    JSON.parse(
      JSON.stringify(priceValue).replace(
        /}$/,
        ',"__proto__":{"polluted":true}}',
      ),
    ),
  );
  for (const key of ["provider", "model"]) {
    for (const value of [
      "",
      " leading",
      "trailing ",
      "x".repeat(513),
      "a\u0000b",
      "a\nb",
      "a\u007fb",
      "a\u200bb",
      "a\u2028b",
      "a\u2029b",
    ])
      invalid.push({ ...priceValue, [key]: value });
  }
  for (const [key, values] of [
    ["category", ["", "INPUT", "reasoning", "cacheWrite1h", "input "]],
    ["currency", ["", "eur", "EU", "EURO", " EUR", "EUＲ", "EUR\n"]],
    [
      "effectiveFrom",
      [
        "",
        "0000-01-01T00:00:00.000Z",
        "2023-02-29T00:00:00.000Z",
        "2024-02-30T00:00:00.000Z",
        "2024-13-01T00:00:00.000Z",
        "2024-01-01T24:00:00.000Z",
        "2024-01-01T00:00:60.000Z",
        "2024-01-01",
        "2024-01-01T00:00:00Z",
        "2024-01-01T00:00:00.000+00:00",
        "2024-01-01T00:00:00.000Z\n",
      ],
    ],
    [
      "ratePerMillion",
      [
        "",
        "-1",
        "+1",
        "01",
        "00.1",
        ".1",
        "1.",
        "1e2",
        "1,2",
        " 1",
        "1 ",
        "1\n",
        "NaN",
        "Infinity",
        "0.0000001",
        "1000000000000",
      ],
    ],
  ]) {
    for (const value of values) invalid.push({ ...priceValue, [key]: value });
  }
  for (const value of invalid) {
    const req = priceRequest();
    const result = dashboard.parseManualPriceRequest(req, priceOrigin);
    req.end(JSON.stringify(value));
    await assert.rejects(result, priceError(400));
    assert.ok(req.destroyed);
    for (const event of ["data", "end", "aborted", "error", "close"])
      assert.equal(req.listenerCount(event), 0);
  }
  assert.equal(Object.prototype.polluted, undefined);
});

test("manual price pure validator is detached and rejects extra own keys", () => {
  const value = { ...priceValue, ratePerMillion: "0" };
  const result = ledgerModule.validateManualPrice(value);
  assert.deepEqual(result, { ...value, ratePerMillion: "0.000000" });
  assert.notEqual(result, value);
  assert.equal(value.ratePerMillion, "0");
  for (const key of [Symbol("extra"), "extra"]) {
    const extra = { ...priceValue };
    Object.defineProperty(extra, key, { value: "PRIVATE_VALUE" });
    assert.throws(() => ledgerModule.validateManualPrice(extra), {
      message: "Invalid manual price",
    });
  }
});

test("price HTTP rejects admission, duplicates and simple requests", async () => {
  for (const [headers, method, url, status] of [
    [{ Origin: undefined }, "POST", "/manual-prices", 403],
    [{ Host: undefined }, "POST", "/manual-prices", 403],
    ...["null", "http://evil.test", priceOrigin + "/"].map((Origin) => [
      { Origin },
      "POST",
      "/manual-prices",
      403,
    ]),
    ...["localhost:1234", "127.0.0.1:1235"].map((Host) => [
      { Host },
      "POST",
      "/manual-prices",
      403,
    ]),
    ...["none", "same-site", "cross-site"].map((site) => [
      { "Sec-Fetch-Site": site },
      "POST",
      "/manual-prices",
      403,
    ]),
    [{}, "GET", "/manual-prices", 405],
    [{}, "POST", "/manual-prices?x=1", 404],
    [{}, "POST", "/other", 404],
    ...[undefined, "text/plain", "application/json; charset=latin1"].map(
      (type) => [{ "Content-Type": type }, "POST", "/manual-prices", 415],
    ),
    [{ "Content-Encoding": "gzip" }, "POST", "/manual-prices", 415],
    [{ "Content-Length": "8193" }, "POST", "/manual-prices", 413],
    [{ "Content-Length": "-1" }, "POST", "/manual-prices", 400],
  ]) {
    const req = priceRequest(headers, method, url);
    await assert.rejects(
      dashboard.parseManualPriceRequest(req, priceOrigin),
      priceError(status),
    );
    assert.ok(req.destroyed);
  }
  for (const key of ["Host", "Origin", "Content-Type", "Sec-Fetch-Site"]) {
    const req = priceRequest();
    if (key === "Sec-Fetch-Site") req.rawHeaders.push(key, "same-origin");
    req.rawHeaders.push(key.toLowerCase(), "PRIVATE_VALUE");
    await assert.rejects(
      dashboard.parseManualPriceRequest(req, priceOrigin),
      priceError(400),
    );
  }
  for (const origin of [
    "http://localhost:1234",
    priceOrigin + "/",
    "http://127.0.0.1:01234",
  ]) {
    await assert.rejects(
      dashboard.parseManualPriceRequest(priceRequest(), origin),
      priceError(403),
    );
  }
});

test("price HTTP rejects malformed JSON and accepts supported headers", async () => {
  for (const body of ["", "{", "{} trailing", "\ufeff{}"]) {
    const req = priceRequest();
    const result = dashboard.parseManualPriceRequest(req, priceOrigin);
    req.end(body);
    await assert.rejects(result, priceError(400));
  }
  const req = priceRequest({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Encoding": "identity",
    "Sec-Fetch-Site": "same-origin",
  });
  const result = dashboard.parseManualPriceRequest(req, priceOrigin);
  req.end(JSON.stringify(priceValue));
  assert.deepEqual(await result, priceValue);
});

test("price HTTP byte limits, fatal UTF8, lifecycle and absolute deadline cleanup", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const clear = t.mock.method(globalThis, "clearTimeout");
  for (const mode of [
    "success",
    "oversize",
    "utf8",
    "aborted",
    "error",
    "close",
    "timeout",
    "length",
  ]) {
    const req = priceRequest(
      mode === "length" ? { "Content-Length": "1" } : {},
    );
    const result = dashboard.parseManualPriceRequest(req, priceOrigin);
    const checked =
      mode === "success"
        ? result
        : assert.rejects(
            result,
            priceError(
              mode === "oversize" ? 413 : mode === "timeout" ? 408 : 400,
            ),
          );
    if (mode === "timeout") {
      t.mock.timers.tick(4999);
      req.write(" "); // Progress must not reset the deadline.
      t.mock.timers.tick(1);
    } else if (["aborted", "error", "close"].includes(mode)) {
      req.emit(mode, new Error("PRIVATE_VALUE"));
    } else if (mode === "oversize") {
      req.write(Buffer.alloc(8192, 32));
      req.end(Buffer.from("é"));
    } else
      req.end(
        mode === "utf8"
          ? Buffer.from([0xc3, 0x28])
          : JSON.stringify(priceValue),
      );
    await checked;
    assert.equal(clear.mock.callCount(), 1, mode);
    clear.mock.resetCalls();
    for (const event of ["data", "end", "aborted", "error", "close"])
      assert.equal(req.listenerCount(event), 0, `${mode}/${event}`);
    t.mock.timers.tick(5000);
  }
  const body = Buffer.from(JSON.stringify(priceValue));
  const req = priceRequest({ "Content-Length": "8192" });
  const result = dashboard.parseManualPriceRequest(req, priceOrigin);
  req.end(Buffer.concat([body, Buffer.alloc(8192 - body.length, 32)]));
  assert.deepEqual(await result, priceValue);
  assert.equal(clear.mock.callCount(), 1);
  t.mock.timers.tick(5000);
});

test("price HTTP loopback chunked harness and production writes remain disabled", async () => {
  const server = http.createServer(async (req, res) => {
    try {
      const value = await dashboard.parseManualPriceRequest(
        req,
        `http://127.0.0.1:${server.address().port}`,
      );
      res.end(JSON.stringify(value));
    } catch {
      if (!res.destroyed) res.end("rejected");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const send = (chunks) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/manual-prices",
          method: "POST",
          headers: {
            Origin: `http://127.0.0.1:${port}`,
            "Content-Type": "application/json",
            "Transfer-Encoding": "chunked",
          },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => resolve(JSON.parse(body)));
        },
      );
      req.on("error", reject);
      for (const chunk of chunks) req.write(chunk);
      req.end();
    });
  try {
    const body = Buffer.from(JSON.stringify(priceValue));
    assert.deepEqual(
      await send([...body].map((byte) => Buffer.from([byte]))),
      priceValue,
    );
    await assert.rejects(send([Buffer.alloc(8192, 32), Buffer.from("é")]));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  const demo = await startDemo(0);
  try {
    assert.equal(
      (await request(demo.address().port, "/manual-prices", { method: "POST" }))
        .status,
      405,
    );
  } finally {
    await new Promise((resolve) => demo.close(resolve));
  }
});

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
    assert.deepEqual(demo.attributionCoverage, {
      "no-task": 0,
      "missing-agent": 0,
      "conflicting-agents": 0,
      "task-consensus": 5,
    });
    const report = ledger.runtimeReport({});
    report.attributionCoverage.PRIVATE_ID = "PRIVATE_PATH";
    const safe = projectDemo(
      report,
      ledger.costReport({ currency: "EUR" }),
      ledger.tokenEvolution({}),
    );
    assert.deepEqual(safe.attributionCoverage, demo.attributionCoverage);
    safe.attributionCoverage["task-consensus"] = 99;
    assert.equal(report.attributionCoverage["task-consensus"], 5);
    assert.match(html, /<caption>Atribución de entradas propias<\/caption>/);
    assert.match(html, /no demuestra roles/);
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
    assert.ok(!renderDashboard(empty).includes("<details>"));
    assert.equal(empty.runtime.total, null);
    assert.ok(Object.values(empty.attributionCoverage).every((n) => n === 0));
    assert.match(renderDashboard(empty), /<td>no-task<\/td><td>0<\/td>/);
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

test("agent detail conserves categories, entries and distinct group sessions", () => {
  const ledger = seeded();
  try {
    ledger.db.exec(`INSERT INTO entries SELECT session, 'SECOND_PRIVATE_ID',
      json_set(data, '$.model', 'alternate', '$.input', 2, '$.output', 3,
        '$.cacheRead', 4, '$.cacheWrite', 5, '$.totalTokens', 14), 'synthetic', 0
      FROM entries WHERE session='a';
      INSERT INTO entries SELECT session, 'THIRD_PRIVATE_ID',
        json_set(data, '$.model', 'priced'), 'synthetic', 0
        FROM entries WHERE session IN ('a', 'd') AND entry='PRIVATE_ID'`);
    const demo = projection(ledger);
    for (const agent of demo.agents) {
      const groups = demo.costs.filter((g) => g.agent === agent.agent);
      assert.equal(
        groups.reduce((n, g) => n + g.entries, 0),
        agent.entries,
      );
      assert.equal(
        groups
          .reduce((n, g) => n + BigInt(g.tokens.totalTokens), 0n)
          .toString(),
        agent.totalTokens,
      );
    }
    for (const model of demo.models) {
      const groups = demo.costs.filter(
        (g) => g.provider === model.provider && g.model === model.model,
      );
      assert.equal(
        groups.reduce((n, g) => n + g.entries, 0),
        model.entries,
      );
      assert.equal(
        groups.reduce((n, g) => n + g.sessions, 0),
        model.sessions,
      );
      for (const key of [...categories, "totalTokens"])
        assert.equal(
          groups.reduce((n, g) => n + BigInt(g.tokens[key]), 0n).toString(),
          model.tokens[key],
        );
    }
    const groups = demo.costs.filter((g) => g.agent === "<demo>");
    assert.equal(
      groups.reduce((n, g) => n + g.sessions, 0),
      3,
    );
    assert.equal(demo.agents[0].sessions, 2);
    assert.deepEqual(groups.find((g) => g.model === "alternate").tokens, {
      input: "2",
      output: "3",
      cacheRead: "4",
      cacheWrite: "5",
      totalTokens: "14",
    });
    assert.equal(
      groups.find((g) => g.model === "priced").tokens.input,
      "27021597764222973",
    );
    assert.equal(groups.find((g) => g.model === "priced").entries, 3);
    assert.equal(
      demo.costs.find((g) => g.agent === "zero").tokens.totalTokens,
      "0",
    );
    const html = renderDashboard(demo);
    assert.equal(
      (html.match(/<details>/g) ?? []).length,
      demo.agents.length + demo.costs.length,
    );
    assert.match(
      html,
      /<details><summary>&lt;demo&gt;<\/summary><details><summary>Proveedor: &quot;synthetic&quot; — Modelo: &quot;alternate&quot;<\/summary>/,
    );
    let depth = 0;
    const tablesByDepth = [];
    for (const [tag] of html.matchAll(/<details>|<\/details>|<table>/g)) {
      if (tag === "<details>") depth++;
      else if (tag === "</details>") depth--;
      else if (depth) tablesByDepth.push(depth);
    }
    assert.equal(depth, 0);
    assert.deepEqual(
      tablesByDepth,
      demo.costs.map(() => 2),
    );
    assert.ok(!/<script|onclick|ontoggle|tabindex|<details\s/.test(html));
    assert.ok(html.includes("Sesiones distintas del grupo"));
    assert.ok(!/SECOND_PRIVATE_ID|THIRD_PRIVATE_ID/.test(html));
  } finally {
    ledger.close();
  }
});

test("detail retains unquoteable tokens, literal null labels and detached public data", () => {
  const ledger = seeded();
  try {
    retime(ledger, "a", "invalid-date");
    ledger.db.exec(`UPDATE entries SET data=json_set(data,
      '$.provider', 'Desconocido (null)', '$.model', 'Desconocido (null)') WHERE session='d'`);
    const snapshot = {
      runtime: ledger.runtimeReport({}),
      costs: ledger.costReport({ currency: "EUR" }),
      evolution: ledger.tokenEvolution({}),
    };
    const before = structuredClone(snapshot);
    const demo = projectDemo(
      snapshot.runtime,
      snapshot.costs,
      snapshot.evolution,
    );
    const invalid = demo.costs.find((g) => g.agent === "<demo>");
    assert.equal(invalid.tokens.input, "18014398509481982");
    assert.equal(invalid.total, null);
    assert.ok(invalid.reasons.includes("invalid-timestamp"));
    assert.equal(demo.costs.filter((g) => g.agent === "unknown").length, 2);
    const literal = demo.costs.find((g) => g.provider === "Desconocido (null)");
    assert.equal(literal.model, "Desconocido (null)");
    assert.equal(literal.tokens.input, "2");
    assert.equal(literal.total, null);
    assert.ok(
      literal.reasons.some((reason) => reason.startsWith("missingPrices")),
    );
    assert.equal(demo.costs.find((g) => g.provider === null).tokens.input, "1");
    for (const group of demo.costs) {
      assert.deepEqual(Object.keys(group).sort(), [
        "agent",
        "coverage",
        "entries",
        "model",
        "provider",
        "reasons",
        "sessions",
        "tokens",
        "total",
      ]);
    }
    assert.ok(
      !/PRIVATE_ID|observation|ratePerMillion|selectedPrices/.test(
        JSON.stringify(demo),
      ),
    );
    demo.costs[0].tokens.input = `<tokens>&"'`;
    demo.costs[0].reasons.push("<reason>");
    demo.costs[0].coverage.completeQuotes = "<coverage>";
    demo.costs[0].provider = "<provider>";
    const html = renderDashboard(demo);
    assert.match(
      html,
      /<summary>Proveedor: Desconocido \(null\) — Modelo: Desconocido \(null\)<\/summary>/,
    );
    assert.match(
      html,
      /<summary>Proveedor: &quot;Desconocido \(null\)&quot; — Modelo: &quot;Desconocido \(null\)&quot;<\/summary>/,
    );
    assert.match(
      html,
      /<summary>Proveedor: &quot;&lt;provider&gt;&quot; — Modelo: &quot;priced&quot;<\/summary>/,
    );
    for (const text of [
      "&lt;tokens&gt;&amp;&quot;&#39;",
      "&lt;reason&gt;",
      "&lt;coverage&gt;",
      "&lt;provider&gt;",
    ])
      assert.ok(html.includes(text), text);
    assert.deepEqual(snapshot, before);
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
    req.end(options.body);
  });
}

function postPrice(port, value = priceValue, options = {}) {
  return request(port, options.path ?? "/manual-prices", {
    method: "POST",
    ...options,
    headers: {
      Origin: `http://127.0.0.1:${port}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: options.body ?? JSON.stringify(value),
  });
}

test("opt-in prices persist canonical retries, conflicts and explicit currency", async () => {
  const path = join(
    mkdtempSync("test/.runtime-dashboard-"),
    "synthetic.sqlite",
  );
  openLedger(path).close();
  const server = await dashboard.startDashboard({
    db: path,
    currency: "USD",
    session: "unknown-session",
    allowManualPrices: true,
  });
  try {
    const port = server.address().port;
    const page = await request(port);
    for (const rate of ["1.2", "1.200000"]) {
      const saved = await postPrice(port, {
        ...priceValue,
        ratePerMillion: rate,
      });
      assert.equal(saved.status, 200);
      assert.deepEqual(JSON.parse(saved.body), priceValue);
      assert.match(saved.headers["content-type"], /^application\/json/);
      assert.equal(saved.headers["cache-control"], "no-store");
      assert.equal(saved.headers["x-content-type-options"], "nosniff");
      assert.equal(
        saved.headers["content-security-policy"],
        page.headers["content-security-policy"],
      );
    }
    const conflict = await postPrice(port, {
      ...priceValue,
      ratePerMillion: "2",
    });
    assert.equal(conflict.status, 409);
    assert.deepEqual(JSON.parse(conflict.body), {
      error: "Manual price conflict",
    });
    const version = {
      ...priceValue,
      effectiveFrom: "2025-01-01T00:00:00.000Z",
    };
    assert.equal((await postPrice(port, version)).status, 200);
    assert.equal((await request(port)).body, page.body);
    assert.equal((await request(port, "/manual-prices")).status, 404);
    for (const method of ["HEAD", "OPTIONS"])
      assert.equal(
        (await request(port, "/manual-prices", { method })).status,
        405,
      );
    const reader = openLedger(path);
    try {
      for (const currency of ["EUR", "USD"])
        assert.deepEqual(
          reader.manualPrices({
            provider: priceValue.provider,
            model: priceValue.model,
            currency,
          }),
          currency === "EUR" ? [priceValue, version] : [],
        );
    } finally {
      reader.close();
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("opt-in prices reject invalid options before storage/listen", async (t) => {
  let opens = 0;
  let listens = 0;
  t.mock.method(DatabaseSync.prototype, "prepare", () => {
    opens++;
    throw new Error();
  });
  t.mock.method(http.Server.prototype, "listen", () => {
    listens++;
    throw new Error();
  });
  for (const allowManualPrices of [null, 0, 1, "true", {}, []])
    await assert.rejects(
      dashboard.startDashboard({
        db: "unused",
        currency: "EUR",
        allowManualPrices,
      }),
      { message: "Dashboard unavailable" },
    );
  for (const options of [
    {},
    { currency: "EUR" },
    { db: "unused" },
    { db: "unused", currency: "eur" },
  ])
    await assert.rejects(
      dashboard.startDashboard({ ...options, allowManualPrices: true }),
      { message: "Dashboard unavailable" },
    );
  assert.equal(opens, 0);
  assert.equal(listens, 0);
});

test("opt-in prices default and transport rejection never open a writer", async (t) => {
  const path = join(
    mkdtempSync("test/.runtime-dashboard-"),
    "synthetic.sqlite",
  );
  openLedger(path).close();
  for (const allowManualPrices of [undefined, false, true]) {
    const server = await dashboard.startDashboard({
      db: path,
      currency: "EUR",
      allowManualPrices,
    });
    const before = readFileSync(path);
    let opens = 0;
    t.mock.method(DatabaseSync.prototype, "prepare", () => {
      opens++;
      throw new Error();
    });
    try {
      const port = server.address().port;
      if (allowManualPrices) {
        for (const options of [
          { headers: { Origin: "null" } },
          { headers: { Host: "localhost:" + port } },
          { headers: { "Sec-Fetch-Site": "none" } },
          { path: "/manual-prices?x=1" },
          { body: JSON.stringify({ ...priceValue, currency: undefined }) },
          { body: " ".repeat(8193) },
        ]) {
          await assert.rejects(postPrice(port, priceValue, options));
        }
        const admitted = once(server, "request");
        const req = http.request({
          hostname: "127.0.0.1",
          port,
          path: "/manual-prices",
          method: "POST",
          headers: {
            Origin: `http://127.0.0.1:${port}`,
            "Content-Type": "application/json",
          },
        });
        req.on("error", () => {});
        const closed = new Promise((resolve) => req.on("close", resolve));
        req.write("{");
        await admitted;
        req.destroy();
        await closed;
      } else assert.equal((await postPrice(port)).status, 405);
      assert.deepEqual(readFileSync(path), before);
      assert.equal(opens, 0);
    } finally {
      t.mock.restoreAll();
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

test("opt-in prices operational failures sanitize and close; committed retry safe", async (t) => {
  const path = join(
    mkdtempSync("test/.runtime-dashboard-"),
    "synthetic.sqlite",
  );
  openLedger(path).close();
  const server = await dashboard.startDashboard({
    db: path,
    currency: "EUR",
    allowManualPrices: true,
  });
  try {
    const port = server.address().port;
    for (const mode of ["open", "save", "close"]) {
      let closes = 0;
      const close = DatabaseSync.prototype.close;
      t.mock.method(DatabaseSync.prototype, "close", function () {
        closes++;
        close.call(this);
        if (mode === "close") throw new Error("PRIVATE_PATH SQL BODY");
      });
      if (mode === "open")
        t.mock.method(DatabaseSync.prototype, "prepare", () => {
          throw new Error("PRIVATE_PATH");
        });
      if (mode === "save") {
        const exec = DatabaseSync.prototype.exec;
        t.mock.method(DatabaseSync.prototype, "exec", function (sql) {
          if (sql === "SAVEPOINT add_manual_price")
            throw new Error("PRIVATE_SQL");
          return exec.call(this, sql);
        });
      }
      const result = await postPrice(port);
      assert.equal(result.status, 500);
      assert.deepEqual(JSON.parse(result.body), {
        error: "Manual price operation failed",
      });
      assert.equal(closes, 1);
      t.mock.restoreAll();
      const reader = openLedger(path);
      try {
        assert.equal(
          reader.manualPrices({
            provider: priceValue.provider,
            model: priceValue.model,
            currency: "EUR",
          }).length,
          mode === "close" ? 1 : 0,
        );
      } finally {
        reader.close();
      }
    }
    assert.equal((await postPrice(port)).status, 200);
  } finally {
    t.mock.restoreAll();
    await new Promise((resolve) => server.close(resolve));
  }
});

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

test("dashboard project startup API CLI and replacement scope", async (t) => {
  const path = join(
    mkdtempSync("test/.runtime-dashboard-"),
    "synthetic.sqlite",
  );
  const writer = seeded(path);
  const literal = "Private_Project-1";
  for (const session of ["a", "c", "e", "f"])
    writer.db
      .prepare("INSERT INTO project_mappings VALUES (?,?)")
      .run(session, literal);
  writer.db
    .prepare("INSERT INTO project_mappings VALUES (?,?)")
    .run("b", "Other");
  writer.close();
  const before = readFileSync(path);
  const expected = (selector, allowManualPrices = false) => {
    const reader = ledgerModule.openReadonlyLedger(path);
    let snapshot;
    try {
      snapshot = reader.dashboardReport({ currency: "EUR", ...selector });
    } finally {
      reader.close();
    }
    return renderDashboard(
      projectDemo(snapshot.runtime, snapshot.costs, snapshot.evolution),
      {
        selected: true,
        projectSelected: selector.projectId !== undefined,
        sessionSelected: selector.session !== undefined,
        allowManualPrices,
      },
    );
  };
  for (const projectId of [
    literal,
    literal.toLowerCase(),
    "absent",
    "x",
    "x".repeat(64),
    "_-0",
  ])
    for (const allowManualPrices of [false, true]) {
      const html = expected({ projectId }, allowManualPrices);
      let closes = 0;
      const close = DatabaseSync.prototype.close;
      const listen = http.Server.prototype.listen;
      t.mock.method(DatabaseSync.prototype, "close", function () {
        closes++;
        return close.call(this);
      });
      t.mock.method(http.Server.prototype, "listen", function (...args) {
        assert.equal(closes, 1, "readonly closed before listen");
        return listen.apply(this, args);
      });
      const server = await dashboard.startDashboard({
        db: path,
        currency: "EUR",
        projectId,
        allowManualPrices,
      });
      t.mock.restoreAll();
      try {
        const port = server.address().port;
        const page = await request(port);
        assert.equal(page.body, html);
        if (projectId === literal && !allowManualPrices)
          assert.deepEqual(readFileSync(path), before);
        assert.match(page.body, /Proyecto seleccionado/);
        assert.ok(!page.body.includes(literal));
        assert.ok(!page.body.includes(path));
        assert.ok(
          page.headers["content-security-policy"].includes(
            "connect-src 'self'",
          ),
        );
        assert.equal(
          page.body.includes('id="manual-price-form"'),
          allowManualPrices,
        );
        if (projectId === literal) {
          assert.ok(html.includes("9007199254740991"));
          assert.ok(html.includes("0.000000000000"));
          assert.ok(html.includes("Desconocido (null)"));
          // Existing submissions replace, never intersect with, startup project.
          for (const selector of [
            { session: "b" },
            {},
            { projectId: "Other" },
          ]) {
            const response = await postPrice(port, selector, {
              path: "/session-filter",
            });
            assert.equal(response.status, 200);
            assert.equal(response.body, expected(selector, allowManualPrices));
            assert.equal(
              response.headers["content-security-policy"],
              page.headers["content-security-policy"],
            );
            assert.equal(
              response.body.includes("Proyecto seleccionado"),
              selector.projectId !== undefined,
            );
          }
          const later = openLedger(path);
          later.db.exec(
            "UPDATE tasks SET agent='later-project-agent' WHERE id='a'",
          );
          later.close();
          assert.equal((await request(port)).body, html);
          const reset = openLedger(path);
          reset.db.exec("UPDATE tasks SET agent='<demo>' WHERE id='a'");
          reset.close();
        } else assert.ok(html.includes("Sin filas"));
        assert.equal((await request(port, "/?project=Other")).status, 404);
        if (!allowManualPrices)
          assert.equal(
            (await request(port, "/manual-prices", { method: "POST" })).status,
            405,
          );
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
      const args = [
        "src/dashboard.js",
        "--db",
        path,
        "--currency",
        "EUR",
        "--project",
        projectId,
      ];
      if (allowManualPrices) args.push("--allow-manual-prices");
      const child = spawn(process.execPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      const exited = once(child, "exit");
      try {
        const output = await Promise.race([
          once(child.stdout, "data"),
          exited.then(() => {
            throw new Error("CLI failed before listen");
          }),
        ]);
        const port = Number(new URL(output[0].toString().trim()).port);
        assert.equal((await request(port)).body, html);
      } finally {
        child.kill("SIGTERM");
        await exited;
      }
    }
});

test("dashboard project invalid before storage listen and CLI startup", async (t) => {
  const path = join(mkdtempSync("test/.runtime-dashboard-"), "missing.sqlite");
  seeded(path).close();
  let reads = 0;
  let listens = 0;
  for (const method of ["prepare", "exec"])
    t.mock.method(DatabaseSync.prototype, method, () => {
      reads++;
      throw new Error("private storage failure");
    });
  t.mock.method(http.Server.prototype, "listen", () => {
    listens++;
    throw new Error();
  });
  for (const projectId of [
    "",
    "x".repeat(65),
    "x\n",
    " x",
    "x ",
    "a/b",
    "a.b",
    "é",
    "😀",
    null,
    1,
    true,
    [],
    {},
    new String("x"),
  ])
    await assert.rejects(
      dashboard.startDashboard({ db: path, currency: "EUR", projectId }),
      { message: "Dashboard unavailable" },
    );
  for (const projectId of ["x", "x".repeat(64)])
    await assert.rejects(
      dashboard.startDashboard({
        db: path,
        currency: "EUR",
        projectId,
        session: "a",
      }),
      { message: "Dashboard unavailable" },
    );
  assert.equal(reads, 0);
  assert.equal(listens, 0);
  t.mock.restoreAll();
  assert.ok(cli(["--help"]).stdout.includes("--project ID"));
  for (const flags of [
    ["--project"],
    ["--project", ""],
    ["--project", "x".repeat(65)],
    ["--project", "x\n"],
    ["--project", "é"],
    ["--project", "a/b"],
    ["--project", "--literal"],
    ["--project=x"],
    ["--project", "x", "--project", "y"],
    ["--project", "x", "--session", "a"],
    ["--session", "a", "--project", "x"],
  ]) {
    const result = cli(["--db", path, "--currency", "EUR", ...flags]);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "Invalid dashboard arguments\n");
  }
  assert.equal(cli(["--demo", "--project", "x"]).status, 2);
});

test("dashboard session API and CLI equal the joint projected snapshot", async (t) => {
  const path = join(
    mkdtempSync("test/.runtime-dashboard-"),
    "synthetic.sqlite",
  );
  const writer = seeded(path);
  const literal = " 私😀e\u0301 ";
  writer.db
    .prepare("UPDATE sources SET session=? WHERE session='a'")
    .run(literal);
  writer.db
    .prepare("UPDATE entries SET session=? WHERE session='a'")
    .run(literal);
  writer.db.exec(`INSERT INTO sources VALUES ('child', 'child', 'b');
    INSERT INTO entries SELECT 'child', entry, data, evidence, conflict FROM entries WHERE session='b'`);
  writer.close();
  const reader = ledgerModule.openReadonlyLedger(path);
  try {
    for (const session of [
      undefined,
      literal,
      literal.trim(),
      literal.normalize("NFC"),
      literal.toUpperCase(),
      "c",
      "d",
      "e",
      "f",
      "child",
      "absent",
      " ",
      "😀".repeat(256),
    ]) {
      const options = { db: path, currency: "EUR" };
      const query = { currency: "EUR" };
      if (session !== undefined) options.session = query.session = session;
      const snapshot = reader.dashboardReport(query);
      const projected = projectDemo(
        snapshot.runtime,
        snapshot.costs,
        snapshot.evolution,
      );
      const expected = renderDashboard(projected, {
        selected: true,
        sessionSelected: session !== undefined,
      });
      assert.ok(!JSON.stringify(projected).includes(literal));
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
      const server = await dashboard.startDashboard(options);
      t.mock.restoreAll();
      try {
        const page = await request(server.address().port);
        assert.equal(page.body, expected);
        assert.match(
          page.body,
          session === undefined ? /Alcance global/ : /Sesión seleccionada/,
        );
        assert.ok(!page.body.includes(literal));
        if (session === literal) {
          assert.ok(page.body.includes("9007199254740991"));
          assert.ok(page.body.includes("9007199254.740991000000"));
        }
        if (session === "c") assert.ok(page.body.includes("0.000000000000"));
        if (session === "e")
          assert.ok(page.body.includes("Desconocido (null)"));
        if (
          [
            "absent",
            literal.trim(),
            literal.normalize("NFC"),
            literal.toUpperCase(),
          ].includes(session)
        )
          assert.equal(projected.coverage.includedEntries, 0);
        if (session === "child") {
          assert.equal(projected.coverage.includedEntries, 0);
          assert.equal(projected.coverage.excludedByCertainty.copied, 1);
        }
        const port = server.address().port;
        assert.equal((await request(port, "/?session=c")).status, 404);
        assert.equal(
          (await request(port, "/manual-prices", { method: "POST" })).status,
          405,
        );
        assert.ok(
          page.headers["content-security-policy"].includes(
            "connect-src 'self'",
          ),
        );
        if (session === literal) {
          const later = openLedger(path);
          later.db
            .prepare("UPDATE tasks SET agent=? WHERE id='a'")
            .run("later");
          later.close();
          assert.equal((await request(port)).body, expected);
          const reset = openLedger(path);
          reset.db
            .prepare("UPDATE tasks SET agent=? WHERE id='a'")
            .run("<demo>");
          reset.close();
        }
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
      const args = ["--db", path, "--currency", "EUR"];
      if (session !== undefined) args.push("--session", session);
      const child = spawn(process.execPath, ["src/dashboard.js", ...args], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      const exited = once(child, "exit");
      try {
        const output = await Promise.race([
          once(child.stdout, "data"),
          exited.then(() => {
            throw new Error("CLI failed before listen");
          }),
        ]);
        const port = Number(new URL(output[0].toString().trim()).port);
        assert.equal((await request(port)).body, expected);
      } finally {
        child.kill("SIGTERM");
        await exited;
      }
    }
  } finally {
    reader.close();
  }
});

test("dashboard session invalid API values fail before storage and listen", async (t) => {
  const path = join(
    mkdtempSync("test/.runtime-dashboard-"),
    "synthetic.sqlite",
  );
  seeded(path).close();
  let reads = 0;
  t.mock.method(DatabaseSync.prototype, "prepare", () => {
    reads++;
    throw new Error("PRIVATE_STORAGE_ERROR");
  });
  let listens = 0;
  t.mock.method(http.Server.prototype, "listen", () => {
    listens++;
    throw new Error("PRIVATE_LISTEN_ERROR");
  });
  for (const session of [
    "",
    "x".repeat(513),
    "😀".repeat(256) + "x",
    null,
    1,
    true,
    [],
    {},
    new String("a"),
  ]) {
    await assert.rejects(
      dashboard.startDashboard({ db: path, currency: "EUR", session }),
      { message: "Dashboard unavailable" },
    );
  }
  assert.equal(reads, 0);
  assert.equal(listens, 0);
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
    assert.equal(
      (await request(port, "/manual-prices", { method: "POST" })).status,
      405,
    );
    assert.deepEqual(readFileSync(path), before);
    const page = await request(port);
    assert.equal(page.status, 200);
    assert.equal(page.body, renderDashboard(fixture(), { selected: true }));
    assert.ok(page.body.includes("BASE SELECCIONADA"));
    assert.match(page.body, /<summary>&lt;demo&gt;<\/summary>/);
    assert.ok(page.body.includes("Sesiones distintas del grupo"));
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
  assert.ok(help.stdout.includes("--allow-manual-prices"));
  assert.ok(help.stdout.includes("--session ID"));
  assert.ok(help.stdout.includes("--db FILE --currency CODE"));
  const dir = mkdtempSync("test/.runtime-dashboard-");
  const missing = join(dir, "PRIVATE_PATH.sqlite");
  for (const args of [
    [],
    ["--allow-manual-prices"],
    ["--demo", "--session", "PRIVATE_SESSION"],
    ...[
      ["--session"],
      ["--session", ""],
      ["--session", "x".repeat(513)],
      ["--session", "--literal"],
      ["--session", "a", "--session", "b"],
      ["--session=a"],
    ].map((flags) => ["--db", "PRIVATE_PATH", "--currency", "EUR", ...flags]),
    ["--demo", "--allow-manual-prices"],
    ["--db", "PRIVATE_PATH", "--currency", "EUR", "--allow-manual-prices=true"],
    [
      "--db",
      "PRIVATE_PATH",
      "--currency",
      "EUR",
      "--allow-manual-prices",
      "--allow-manual-prices",
    ],
    [
      "--db",
      "PRIVATE_PATH",
      "--currency",
      "EUR",
      "--allow-manual-prices",
      "true",
    ],
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
    assert.equal(result.stderr, "Invalid dashboard arguments\n");
    assert.equal(existsSync(missing), false);
  }
});

test("model token sorting and static navigation", async () => {
  const { comparisonNavigationScript } = await import(
    "../src/comparison-navigation.js"
  );
  const demo = fixture();
  const values = ["9007199254740993", "9007199254740992", "0", "2", "2"];
  demo.models = values.map((value, index) => ({
    provider: index === 4 ? null : '<unsafe"provider>',
    model: index === 4 ? null : `model-${index}`,
    entries: 1,
    sessions: 1,
    tokens: Object.fromEntries(
      [...categories, "totalTokens"].map((key) => [key, value]),
    ),
  }));
  const before = structuredClone(demo);
  for (const selected of [false, true]) {
    const html = renderDashboard(demo, { selected });
    for (const id of [
      "comparison-agents",
      "comparison-models",
      "comparison-detail",
    ]) {
      assert.ok(html.includes(`href="#${id}"`));
      assert.equal((html.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1);
    }
    assert.equal(
      (html.match(/data-token-sort=/g) ?? []).length,
      selected ? 5 : 0,
    );
    assert.equal(html.includes(comparisonNavigationScript), selected);
    assert.ok(!html.includes('<unsafe"provider>'));
    assert.ok(!html.includes("PRIVATE_ID"));
    if (selected) {
      const region = html
        .split('<div id="dashboard-report">')[1]
        .split(`</div>\n<script>${comparisonNavigationScript}</script>`)[0];
      assert.ok(!/<script|<form/.test(region));
      assert.match(
        region,
        /aria-sort="descending"><button type="button" data-token-sort="4">totalTokens/,
      );
      assert.match(region, /data-identity-order="0"/);
    }
  }
  assert.deepEqual(
    demo,
    before,
    "rendering leaves the public projection detached",
  );
  let click;
  const makeTable = () => {
    const headers = values.map((_, index) => ({
      state: index === 4 ? "descending" : "none",
      getAttribute() {
        return this.state;
      },
      setAttribute(name, value) {
        assert.equal(name, "aria-sort");
        this.state = value;
      },
    }));
    const buttons = headers.map((header, index) => ({
      dataset: { tokenSort: String(index) },
      closest: (selector) => (selector === "th" ? header : table),
    }));
    const rows = values.map((_, index) => ({
      dataset: { identityOrder: String(index === 4 ? 0 : index + 1) },
      cells: [
        {},
        {},
        {},
        {},
        ...values.map((_, column) => ({
          textContent: values[(index + column) % values.length],
        })),
      ],
      index,
    }));
    const body = {
      rows: [...rows],
      append(...ordered) {
        this.rows = ordered;
      },
    };
    const table = {
      tBodies: [body],
      querySelectorAll: () => buttons,
    };
    return { buttons, headers, body };
  };
  runInNewContext(comparisonNavigationScript, {
    document: {
      addEventListener: (name, handler) => {
        assert.equal(name, "click", "native buttons handle Tab/Enter/Space");
        click = handler;
      },
    },
  });
  let current = makeTable();
  const activate = (index) =>
    click({ target: { closest: () => current.buttons[index] } });
  click({ target: { closest: () => null } });
  for (let index = 0; index < 5; index++) {
    current = makeTable();
    activate(index);
    const descending = [
      [0, 1, 4, 3, 2],
      [4, 0, 2, 3, 1],
      [3, 4, 1, 2, 0],
      [2, 3, 0, 1, 4],
      [1, 2, 4, 0, 3],
    ];
    const ascending = [
      [2, 4, 3, 1, 0],
      [1, 2, 3, 0, 4],
      [0, 1, 2, 4, 3],
      [4, 0, 1, 3, 2],
      [3, 4, 0, 2, 1],
    ];
    assert.deepEqual(
      current.body.rows.map((row) => row.index),
      index === 4 ? ascending[index] : descending[index],
    );
    activate(index);
    assert.deepEqual(
      current.body.rows.map((row) => row.index),
      index === 4 ? descending[index] : ascending[index],
    );
    const direction = index === 4 ? "descending" : "ascending";
    assert.ok(
      current.headers.every(
        (header, i) => header.state === (i === index ? direction : "none"),
      ),
    );
    assert.equal(current.buttons[index].closest("th"), current.headers[index]);
  }
  const { sessionFilterScript } = await import("../src/session-filter-form.js");
  const fields = Object.fromEntries(
    ["mode", "session", "projectId", "taskId"].map((key) => [
      key,
      { value: "" },
    ]),
  );
  let submit;
  let status = 200;
  const form = {
    elements: { namedItem: (key) => fields[key] },
    addEventListener: (_, handler) => {
      submit = handler;
    },
  };
  const region = {
    replaceWith() {
      current = makeTable();
    },
  };
  runInNewContext(sessionFilterScript, {
    document: {
      getElementById: (id) =>
        ({
          "session-filter-form": form,
          "session-filter-submit": {},
          "session-filter-feedback": {},
          "dashboard-report": region,
        })[id],
    },
    DOMParser: class {
      parseFromString() {
        return {
          querySelectorAll: () => [
            {
              querySelector: (selector) =>
                selector === "[data-dashboard-scope]" ? {} : null,
            },
          ],
        };
      }
    },
    fetch: async () => ({
      status,
      headers: { get: () => "text/html" },
      text: async () => "synthetic report",
    }),
  });
  current = makeTable();
  activate(0);
  const old = current;
  status = 500;
  fields.mode.value = "global";
  await submit({ preventDefault() {} });
  assert.equal(
    current,
    old,
    "failed query retains sorted DOM and header state",
  );
  assert.equal(current.headers[0].state, "descending");
  status = 200;
  for (const mode of ["global", "session", "project", "task"]) {
    fields.mode.value = mode;
    fields.session.value =
      fields.projectId.value =
      fields.taskId.value =
        "synthetic";
    await submit({ preventDefault() {} });
    assert.notEqual(current, old);
    assert.equal(current.headers[4].state, "descending");
    assert.equal(current.headers[0].state, "none");
  }
  activate(4);
  assert.deepEqual(
    current.body.rows.map((row) => row.index),
    [3, 4, 0, 2, 1],
  );
  assert.deepEqual(
    old.body.rows.map((row) => row.index),
    [0, 1, 4, 3, 2],
  );
  current.body.rows = [];
  activate(4);
  assert.deepEqual(current.body.rows, []);
});

test("manual form gating and exact script CSP", async () => {
  const path = join(
    mkdtempSync("test/.runtime-dashboard-"),
    "synthetic.sqlite",
  );
  openLedger(path).close();
  for (const mode of ["demo", false, true]) {
    const server =
      mode === "demo"
        ? await startDemo()
        : await dashboard.startDashboard({
            db: path,
            currency: "EUR",
            allowManualPrices: mode,
            session: "unknown-session",
          });
    try {
      const page = await request(server.address().port);
      const scripts = [...page.body.matchAll(/<script>([\s\S]*?)<\/script>/g)];
      assert.equal(scripts.length, mode === "demo" ? 0 : mode === true ? 3 : 2);
      assert.equal(
        (page.body.match(/<form\b/g) ?? []).length,
        mode === "demo" ? 0 : mode === true ? 2 : 1,
      );
      const csp = page.headers["content-security-policy"];
      const { sessionFilterScript } = await import(
        "../src/session-filter-form.js"
      );
      if (mode === "demo") {
        assert.ok(!page.body.includes('name="projectId"'));
      } else {
        const { comparisonNavigationScript } = await import(
          "../src/comparison-navigation.js"
        );
        assert.ok(
          scripts.some(([, script]) => script === comparisonNavigationScript),
        );
        assert.ok(scripts.some(([, script]) => script === sessionFilterScript));
        assert.match(
          page.body,
          /<option value="project">Proyecto literal<\/option>/,
        );
        assert.match(page.body, /<label for="project-id">ID de proyecto/);
        assert.match(
          page.body,
          /id="project-id" name="projectId" type="text" maxlength="64"/,
        );
        assert.match(
          page.body,
          /role="status" aria-live="polite" aria-atomic="true"/,
        );
        const projectInput = page.body.match(/<input id="project-id"[^>]*>/)[0];
        assert.ok(!/pattern=|required|tabindex=|on\w+=/.test(projectInput));
        assert.ok(!sessionFilterScript.includes("innerHTML"));
      }
      assert.equal((csp.match(/'sha256-/g) ?? []).length, scripts.length);
      for (const [, script] of scripts) {
        const hash = createHash("sha256").update(script).digest("base64");
        assert.ok(csp.includes(`'sha256-${hash}'`));
      }
      const region = page.body
        .split('<div id="dashboard-report">')[1]
        .split("</div>\n<script>")[0];
      if (mode === true) {
        assert.ok(!region.includes("<form") && !region.includes("<script"));
        assert.ok(csp.includes("connect-src 'self'"));
        assert.equal((page.body.match(/<label\b/g) ?? []).length, 10);
        for (const key of Object.keys(priceValue))
          assert.ok(page.body.includes(`name="${key}"`));
        for (const category of ["input", "output", "cacheRead", "cacheWrite"])
          assert.ok(page.body.includes(`value="${category}"`));
        assert.match(page.body, /append-only/);
        assert.match(page.body, /no son una factura/);
        assert.ok(!scripts[0][1].includes("innerHTML"));
      } else {
        assert.ok(
          csp.includes(
            mode === "demo"
              ? "script-src 'none'; connect-src 'none'"
              : "connect-src 'self'",
          ),
        );
      }
      assert.ok(csp.includes("frame-src 'none'; frame-ancestors 'none'"));
      assert.ok(
        csp.endsWith(
          "style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
        ),
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

test("manual form exact zero payload, pending, canonical feedback and failures", async () => {
  const { manualPriceScript } = await import("../src/manual-price-form.js");
  const fields = Object.fromEntries(
    Object.entries({
      ...priceValue,
      provider: '<img src=x onerror="bad()">',
      ratePerMillion: "0",
    }).map(([key, value]) => [key, { value, disabled: false }]),
  );
  const button = { disabled: false };
  const feedback = { textContent: "" };
  let submit;
  const form = {
    elements: { ...fields, namedItem: (key) => fields[key] },
    addEventListener: (name, handler) => {
      assert.equal(name, "submit");
      submit = handler;
    },
  };
  const calls = [];
  let settle;
  runInNewContext(manualPriceScript, {
    document: {
      getElementById: (id) =>
        ({
          "manual-price-form": form,
          "manual-price-submit": button,
          "manual-price-feedback": feedback,
        })[id],
    },
    fetch: (url, options) => {
      calls.push({ url, options });
      return new Promise((resolve, reject) => {
        settle = { resolve, reject };
      });
    },
  });
  const event = { preventDefault() {} };
  for (const outcome of [
    "success",
    "conflict",
    "operation",
    "network",
    "invalid-json",
  ]) {
    const count = calls.length;
    const pending = submit(event);
    await submit(event);
    assert.equal(calls.length, count + 1);
    assert.equal(button.disabled, true);
    assert.ok(Object.values(fields).every((field) => field.disabled));
    const { url, options } = calls.at(-1);
    assert.equal(url, "/manual-prices");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["Content-Type"], "application/json");
    const expected = Object.fromEntries(
      Object.entries(fields).map(([k, f]) => [k, f.value]),
    );
    assert.deepEqual(JSON.parse(options.body), expected);
    if (outcome === "network") settle.reject(new Error("secret"));
    else
      settle.resolve({
        status:
          outcome === "conflict" ? 409 : outcome === "operation" ? 500 : 200,
        json: async () => {
          if (outcome === "invalid-json") throw new Error("secret");
          return { ...expected, ratePerMillion: "0.000000" };
        },
      });
    await pending;
    assert.equal(button.disabled, false);
    assert.ok(Object.values(fields).every((field) => !field.disabled));
    assert.equal(fields.ratePerMillion.value, "0");
    assert.equal(calls.length, count + 1);
    if (outcome === "success") {
      assert.ok(
        feedback.textContent.includes(
          JSON.stringify({ ...expected, ratePerMillion: "0.000000" }),
        ),
      );
    } else
      assert.match(
        feedback.textContent,
        outcome === "conflict" ? /Conflicto/ : /No se pudo guardar/,
      );
    assert.ok(!feedback.textContent.includes("secret"));
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
      ["--db", path, "--currency", "EUR", "--allow-manual-prices"],
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
      if (args.includes("--allow-manual-prices"))
        assert.equal((await postPrice(port)).status, 200);
      assert.match(page.body, /<caption>Evolución diaria — UTC<\/caption>/);
      assert.ok(page.body.includes("18014398509481985"));
      assert.equal(page.body.includes("<script"), !args.includes("--demo"));
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
