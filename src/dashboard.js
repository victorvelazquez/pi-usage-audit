import http from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { projectDemo, renderDashboard } from "./dashboard-report.js";
import { manualPriceScript } from "./manual-price-form.js";
import { sessionFilterScript } from "./session-filter-form.js";

const sessionScriptHash = createHash("sha256")
  .update(sessionFilterScript)
  .digest("base64");

const manualScriptHash = createHash("sha256")
  .update(manualPriceScript)
  .digest("base64");

class ManualPriceRequestError extends Error {
  constructor(status) {
    super("Manual price request rejected");
    this.name = "ManualPriceRequestError";
    this.status = status;
  }
}

class SessionFilterRequestError extends Error {
  constructor(status) {
    super("Session filter request rejected");
    this.name = "SessionFilterRequestError";
    this.status = status;
  }
}

// Shared admission/body lifecycle; only private callers choose a route/error type.
// Failures destroy the request/connection; callers must not reuse it.
async function parseJsonRequest(req, expectedOrigin, route, RequestError) {
  const deny = (status) => {
    req.destroy();
    throw new RequestError(status);
  };
  if (typeof expectedOrigin !== "string") deny(403);
  const match = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/.exec(expectedOrigin);
  if (!match || Number(match[1]) > 65535) deny(403);
  const headers = new Map();
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const key = req.rawHeaders[i].toLowerCase();
    if (headers.has(key)) deny(400);
    headers.set(key, req.rawHeaders[i + 1]);
  }
  if (
    headers.get("host") !== expectedOrigin.slice(7) ||
    headers.get("origin") !== expectedOrigin ||
    (headers.has("sec-fetch-site") &&
      headers.get("sec-fetch-site") !== "same-origin")
  )
    deny(403);
  if (req.method !== "POST") deny(405);
  if (req.url !== route) deny(404);
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
      headers.get("content-type") ?? "",
    )
  )
    deny(415);
  if (
    headers.has("content-encoding") &&
    headers.get("content-encoding") !== "identity"
  )
    deny(415);
  const declared = headers.get("content-length");
  if (declared !== undefined && !/^(0|[1-9]\d*)$/.test(declared)) deny(400);
  if (declared !== undefined && BigInt(declared) > 8192n) deny(413);
  const body = await new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const deadline = Date.now() + 5000;
    const finish = (status) => {
      clearTimeout(timer);
      for (const [event, handler] of listeners)
        req.removeListener(event, handler);
      if (status) {
        req.destroy();
        reject(new RequestError(status));
      } else resolve(Buffer.concat(chunks, size));
    };
    const listeners = [
      [
        "data",
        (chunk) => {
          if (Date.now() >= deadline) return finish(408);
          if (!Buffer.isBuffer(chunk)) return finish(400);
          size += chunk.length;
          if (size > 8192) return finish(413);
          chunks.push(chunk);
        },
      ],
      [
        "end",
        () =>
          finish(
            Date.now() >= deadline
              ? 408
              : declared !== undefined && BigInt(declared) !== BigInt(size)
                ? 400
                : 0,
          ),
      ],
      ["aborted", () => finish(400)],
      ["error", () => finish(400)],
      ["close", () => finish(400)],
    ];
    const timer = setTimeout(() => finish(408), 5000);
    for (const [event, handler] of listeners) req.on(event, handler);
    if (req.destroyed || req.readableEnded || req.aborted) finish(400);
  });
  let value;
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    value = JSON.parse(decoder.decode(body));
  } catch {
    deny(400);
  }
  return value;
}

// Internal parser for the explicitly opted-in selected-database server.
// Returns the canonical six-field price without opening storage.
export async function parseManualPriceRequest(req, expectedOrigin) {
  const value = await parseJsonRequest(
    req,
    expectedOrigin,
    "/manual-prices",
    ManualPriceRequestError,
  );
  let validateManualPrice;
  try {
    ({ validateManualPrice } = await import("./ledger.js"));
  } catch (error) {
    req.destroy();
    throw error; // Loading failures are operational, not invalid input.
  }
  try {
    return validateManualPrice(value);
  } catch {
    req.destroy();
    throw new ManualPriceRequestError(400);
  }
}

// POST admission only: no storage or ID echo.
// Exported for synthetic tests; a selector is not a report or an HTTP response.
export async function parseSessionFilterRequest(req, expectedOrigin) {
  const value = await parseJsonRequest(
    req,
    expectedOrigin,
    "/session-filter",
    SessionFilterRequestError,
  );
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const keys = Reflect.ownKeys(value);
    if (keys.length === 0) return {};
    if (
      keys.length === 1 &&
      keys[0] === "session" &&
      validSession(value.session)
    )
      return { session: value.session };
    if (
      keys.length === 1 &&
      keys[0] === "projectId" &&
      validProject(value.projectId)
    )
      return { projectId: value.projectId };
    if (keys.length === 1 && keys[0] === "taskId" && validSession(value.taskId))
      return { taskId: value.taskId };
  }
  req.destroy();
  throw new SessionFilterRequestError(400);
}

export async function startDemo(port) {
  let html;
  try {
    const file = new URL(
      "../test/fixtures/dashboard-demo.json",
      import.meta.url,
    );
    html = renderDashboard(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    throw new Error("Demo unavailable");
  }
  return serve(html, port);
}

function validSession(session) {
  return (
    typeof session === "string" && session.length > 0 && session.length <= 512
  );
}

function validProject(projectId) {
  return (
    typeof projectId === "string" &&
    projectId.match(/^[A-Za-z0-9_-]{1,64}$/)?.[0] === projectId
  );
}

export async function startDashboard({
  db,
  currency,
  session,
  projectId,
  taskId,
  port = 0,
  allowManualPrices = false,
}) {
  try {
    if (
      (session !== undefined && !validSession(session)) ||
      (projectId !== undefined && !validProject(projectId)) ||
      (taskId !== undefined && !validSession(taskId)) ||
      [session, projectId, taskId].filter((value) => value !== undefined)
        .length > 1 ||
      typeof allowManualPrices !== "boolean" ||
      typeof db !== "string" ||
      !db ||
      !/^[A-Z]{3}$/.test(currency ?? "")
    )
      throw new Error();
    const { openReadonlyLedger } = await import("./ledger.js");
    const ledger = openReadonlyLedger(db);
    let html;
    try {
      const snapshot = ledger.dashboardReport({
        currency,
        ...(session === undefined ? {} : { session }),
        ...(projectId === undefined ? {} : { projectId }),
        ...(taskId === undefined ? {} : { taskId }),
      });
      html = renderDashboard(
        projectDemo(snapshot.runtime, snapshot.costs, snapshot.evolution),
        {
          selected: true,
          sessionSelected: session !== undefined,
          projectSelected: projectId !== undefined,
          taskSelected: taskId !== undefined,
          allowManualPrices,
        },
      );
    } finally {
      ledger.close();
    }
    // Interactive submissions replace startup scope entirely.
    // Retain only the static HTML, not a selector in route options.
    return await serve(html, port, { db, currency, allowManualPrices });
  } catch {
    throw new Error("Dashboard unavailable");
  }
}

async function saveManualPrice(req, res, origin, db) {
  let status = 200;
  let result;
  try {
    const price = await parseManualPriceRequest(req, origin);
    const { openExistingLedger } = await import("./ledger.js");
    const writer = openExistingLedger(db);
    try {
      result = writer.addManualPrice(price);
    } catch (error) {
      if (error.message !== "Manual price conflict") throw error;
      status = 409;
      result = { error: "Manual price conflict" };
    } finally {
      writer.close();
    }
  } catch (error) {
    // Parser rejection destroys the transport; its status is not an HTTP reply.
    if (error instanceof ManualPriceRequestError) {
      req.socket.destroy();
      return;
    }
    if (req.socket.destroyed || res.destroyed) return;
    status = 500;
    result = { error: "Manual price operation failed" };
  }
  if (res.destroyed) return;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.writeHead(status);
  res.end(JSON.stringify(result));
}

async function filterSession(req, res, origin, options) {
  let html;
  try {
    const selector = await parseSessionFilterRequest(req, origin);
    const { openReadonlyLedger } = await import("./ledger.js");
    const reader = openReadonlyLedger(options.db);
    try {
      const snapshot = reader.dashboardReport({
        currency: options.currency,
        ...selector,
      });
      html = renderDashboard(
        projectDemo(snapshot.runtime, snapshot.costs, snapshot.evolution),
        {
          selected: true,
          sessionSelected: selector.session !== undefined,
          projectSelected: selector.projectId !== undefined,
          taskSelected: selector.taskId !== undefined,
          allowManualPrices: options.allowManualPrices,
        },
      );
    } finally {
      reader.close();
    }
  } catch (error) {
    if (error instanceof SessionFilterRequestError) {
      req.socket.destroy();
      return;
    }
    if (req.socket.destroyed || res.destroyed) return;
    res.writeHead(500);
    res.end("Session filter operation failed");
    return;
  }
  if (res.destroyed) return;
  res.writeHead(200);
  res.end(html);
}

async function serve(html, port, options) {
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'none'; ${
        options === undefined
          ? "script-src 'none'; connect-src 'none'"
          : `script-src 'sha256-${sessionScriptHash}'${
              options.allowManualPrices ? ` 'sha256-${manualScriptHash}'` : ""
            }; connect-src 'self'`
      }; frame-src 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`,
    );
    const host = `127.0.0.1:${server.address().port}`;
    if (
      options !== undefined &&
      req.method === "POST" &&
      req.url === "/session-filter"
    ) {
      void filterSession(req, res, `http://${host}`, options);
      return;
    }
    if (options?.allowManualPrices && req.method === "POST") {
      void saveManualPrice(req, res, `http://${host}`, options.db);
      return;
    }
    const site = req.headers["sec-fetch-site"];
    const denied =
      req.headers.host !== host ||
      (req.headers.origin !== undefined &&
        req.headers.origin !== `http://${host}`) ||
      (site !== undefined && site !== "none" && site !== "same-origin");
    const status = denied
      ? 403
      : req.method === "GET"
        ? req.url === "/"
          ? 200
          : 404
        : 405;
    if (status === 405) res.setHeader("Allow", "GET");
    res.writeHead(status);
    res.end(status === 200 ? html : "Request rejected");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}

function parse(args) {
  if (args.length === 1 && args[0] === "--help") return null;
  const seen = new Set();
  const options = { port: 0 };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (
      seen.has(flag) ||
      ![
        "--demo",
        "--port",
        "--db",
        "--currency",
        "--session",
        "--project",
        "--task-id",
        "--allow-manual-prices",
      ].includes(flag)
    )
      throw new Error();
    seen.add(flag);
    if (flag === "--port") {
      const value = args[++i];
      if (!/^(0|[1-9]\d{0,4})$/.test(value ?? "") || Number(value) > 65535)
        throw new Error();
      options.port = Number(value);
    } else if (flag === "--allow-manual-prices") {
      options.allowManualPrices = true;
    } else if (flag !== "--demo") {
      const value = args[++i];
      if (
        !value ||
        value.startsWith("--") ||
        (flag === "--session" && !validSession(value)) ||
        (flag === "--project" && !validProject(value)) ||
        (flag === "--task-id" && !validSession(value))
      )
        throw new Error();
      const key =
        { "--project": "projectId", "--task-id": "taskId" }[flag] ??
        flag.slice(2);
      options[key] = value;
    }
  }
  if (
    ["--session", "--project", "--task-id"].filter((flag) => seen.has(flag))
      .length > 1
  )
    throw new Error();
  options.demo = seen.has("--demo");
  if (options.demo) {
    if (
      seen.has("--db") ||
      seen.has("--currency") ||
      seen.has("--session") ||
      seen.has("--project") ||
      seen.has("--task-id") ||
      options.allowManualPrices
    )
      throw new Error();
  } else if (!options.db || !/^[A-Z]{3}$/.test(options.currency ?? "")) {
    throw new Error();
  }
  return options;
}
async function main() {
  let options;
  try {
    options = parse(process.argv.slice(2));
  } catch {
    console.error("Invalid dashboard arguments");
    process.exitCode = 2;
    return;
  }
  if (options === null) {
    console.log(
      "Usage: node src/dashboard.js --demo [--port N]\n       node src/dashboard.js --db FILE --currency CODE [--port N] [--session ID | --project ID | --task-id ID] [--allow-manual-prices]\n       node src/dashboard.js --help",
    );
    return;
  }
  try {
    const server = options.demo
      ? await startDemo(options.port)
      : await startDashboard(options);
    const close = () => server.close();
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
    console.log(`http://127.0.0.1:${server.address().port}/`);
  } catch {
    console.error(options.demo ? "Demo unavailable" : "Dashboard unavailable");
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
