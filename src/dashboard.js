import http from "node:http";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { projectDemo, renderDashboard } from "./dashboard-report.js";

class ManualPriceRequestError extends Error {
  constructor(status) {
    super("Manual price request rejected");
    this.name = "ManualPriceRequestError";
    this.status = status;
  }
}

// Internal parser for future opt-in wiring; neither server calls this.
// Returns the canonical six-field price without opening storage.
// Failures destroy the request/connection; callers must not reuse it.
export async function parseManualPriceRequest(req, expectedOrigin) {
  const deny = (status) => {
    req.destroy();
    throw new ManualPriceRequestError(status);
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
  if (req.url !== "/manual-prices") deny(404);
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
        reject(new ManualPriceRequestError(status));
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
    deny(400);
  }
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

export async function startDashboard({ db, currency, port = 0 }) {
  try {
    if (typeof db !== "string" || !db || !/^[A-Z]{3}$/.test(currency ?? ""))
      throw new Error();
    const { openReadonlyLedger } = await import("./ledger.js");
    const ledger = openReadonlyLedger(db);
    let html;
    try {
      const snapshot = ledger.dashboardReport({ currency });
      html = renderDashboard(
        projectDemo(snapshot.runtime, snapshot.costs, snapshot.evolution),
        { selected: true },
      );
    } finally {
      ledger.close();
    }
    return await serve(html, port);
  } catch {
    throw new Error("Dashboard unavailable");
  }
}

async function serve(html, port) {
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'none'; connect-src 'none'; frame-src 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    );
    const host = `127.0.0.1:${server.address().port}`;
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
      !["--demo", "--port", "--db", "--currency"].includes(flag)
    )
      throw new Error();
    seen.add(flag);
    if (flag === "--port") {
      const value = args[++i];
      if (!/^(0|[1-9]\d{0,4})$/.test(value ?? "") || Number(value) > 65535)
        throw new Error();
      options.port = Number(value);
    } else if (flag !== "--demo") {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error();
      options[flag.slice(2)] = value;
    }
  }
  options.demo = seen.has("--demo");
  if (options.demo) {
    if (seen.has("--db") || seen.has("--currency")) throw new Error();
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
      "Usage: node src/dashboard.js --demo [--port N]\n       node src/dashboard.js --db FILE --currency CODE [--port N]\n       node src/dashboard.js --help",
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
