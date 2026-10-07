import http from "node:http";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { renderDashboard } from "./dashboard-report.js";

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
  let port = 0;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag) || !["--demo", "--port"].includes(flag))
      throw new Error();
    seen.add(flag);
    if (flag === "--port") {
      const value = args[++i];
      if (!/^(0|[1-9]\d{0,4})$/.test(value ?? "") || Number(value) > 65535)
        throw new Error();
      port = Number(value);
    }
  }
  if (!seen.has("--demo")) throw new Error();
  return port;
}
async function main() {
  let port;
  try {
    port = parse(process.argv.slice(2));
  } catch {
    console.error("Invalid demo arguments");
    process.exitCode = 2;
    return;
  }
  if (port === null) {
    console.log(
      "Usage: node src/dashboard.js --demo [--port N]\n       node src/dashboard.js --help",
    );
    return;
  }
  try {
    const server = await startDemo(port);
    const close = () => server.close();
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
    console.log(`http://127.0.0.1:${server.address().port}/`);
  } catch {
    console.error("Demo unavailable");
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
