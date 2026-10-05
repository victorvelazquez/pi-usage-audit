import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { homedir } from "node:os";
import { createHash, createHmac, randomBytes } from "node:crypto";

export const defaultDatabasePath = () =>
  join(homedir(), ".local", "state", "pi-usage-audit", "usage.sqlite");
const text = (value) =>
  typeof value === "string" && value.length > 0 && value.length <= 512
    ? value
    : null;
const number = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
const counter = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : null;
function pathKey(path) {
  const normalized = resolve(path);
  return createHash("sha256")
    .update(
      process.platform === "win32" ? normalized.toLowerCase() : normalized,
    )
    .digest("hex");
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
function storedJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("Ledger metadata is corrupt");
  }
}
function retryBusy(fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return fn();
    } catch (error) {
      if (!/database is (locked|busy)/i.test(error.message) || attempt >= 20)
        throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}
function normalize(entry, secret) {
  const message = entry.message;
  let source = entry;
  let operation = entry.type;
  if (entry.type === "message") {
    if (!["assistant", "toolResult"].includes(message?.role)) return null;
    if (message.stopReason === "pending") return { pending: true };
    source = message;
    operation = message.role;
  } else if (!["usage", "compaction", "branch_summary"].includes(entry.type))
    return null;
  // Summaries without usage are not proof of a model call (hooks can produce them).
  if (operation !== "assistant" && source.usage === undefined) return null;
  const u = source.usage;
  const categories = ["input", "output", "cacheRead", "cacheWrite"];
  const tokens = Object.fromEntries(
    [...categories, "totalTokens", "reasoning", "cacheWrite1h"].map((key) => [
      key,
      counter(u?.[key]),
    ]),
  );
  const complete =
    categories.every((key) => tokens[key] !== null) &&
    tokens.totalTokens !== null &&
    categories.reduce((sum, key) => sum + tokens[key], 0) ===
      tokens.totalTokens &&
    (u?.reasoning === undefined ||
      (tokens.reasoning !== null && tokens.reasoning <= tokens.output)) &&
    (u?.cacheWrite1h === undefined ||
      (tokens.cacheWrite1h !== null &&
        tokens.cacheWrite1h <= tokens.cacheWrite));
  const data = {
    ...tokens,
    operation,
    kind: entry.type === "usage" ? text(entry.kind) : null,
    provider: text(source.provider),
    model: text(source.model),
    timestamp: text(entry.timestamp),
    runtimeEstimate: number(u?.cost?.total),
    estimateProvenance: "runtime-estimate",
    certainty: complete
      ? operation === "toolResult"
        ? "nested-unknown"
        : "own"
      : "incomplete",
  };
  // A keyed fingerprint supplies copy evidence without retaining transcript material.
  // parentId is intentionally absent: Pi re-chains retained history on forks.
  const evidence = createHmac("sha256", secret)
    .update(
      JSON.stringify(
        canonical({
          type: entry.type,
          timestamp: entry.timestamp ?? null,
          messageTimestamp: message?.timestamp ?? null,
          data,
          content: message?.content ?? entry.summary ?? null,
        }),
      ),
    )
    .digest("hex");
  return { data, evidence };
}

const manualKeys = [
  "provider",
  "model",
  "category",
  "currency",
  "effectiveFrom",
  "ratePerMillion",
];
const priceCategories = ["input", "output", "cacheRead", "cacheWrite"];
const canonicalUtc = (date) =>
  typeof date === "string" &&
  /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(date) &&
  date.length === 24 &&
  Number.isFinite(new Date(date).getTime()) &&
  new Date(date).toISOString() === date;
const fixedAmount = (scaled) =>
  `${scaled / 1000000000000n}.${(scaled % 1000000000000n).toString().padStart(12, "0")}`;
function validateManual(value, keys, error = "Invalid manual price") {
  const invalid = () => {
    throw new Error(error);
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || !keys.every((key) => own.includes(key)))
    invalid();
  for (const key of ["provider", "model"]) {
    const id = value[key];
    if (!text(id) || id.trim() !== id || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(id))
      invalid();
  }
  if (
    typeof value.currency !== "string" ||
    value.currency.length !== 3 ||
    !/^[A-Z]{3}$/.test(value.currency)
  )
    invalid();
  if (keys.includes("at")) {
    if (!canonicalUtc(value.at)) invalid();
    const usage = value.usage;
    if (!usage || typeof usage !== "object" || Array.isArray(usage)) invalid();
    for (const key of Reflect.ownKeys(usage)) {
      if (!priceCategories.includes(key)) invalid();
      if (usage[key] !== null && counter(usage[key]) === null) invalid();
    }
    return { ...value };
  }
  if (!keys.includes("category")) return { ...value };
  if (!priceCategories.includes(value.category)) invalid();
  if (!canonicalUtc(value.effectiveFrom)) invalid();
  const rate = value.ratePerMillion;
  if (
    typeof rate !== "string" ||
    rate.match(/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/)?.[0] !== rate
  )
    invalid();
  const [whole, fraction = ""] = rate.split(".");
  return { ...value, ratePerMillion: `${whole}.${fraction.padEnd(6, "0")}` };
}

export function openLedger(path = defaultDatabasePath()) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout=5000");
    retryBusy(() => db.exec("PRAGMA journal_mode=WAL"));
    retryBusy(() =>
      db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sources (path TEXT PRIMARY KEY, session TEXT NOT NULL, parent TEXT);
      CREATE TABLE IF NOT EXISTS entries (session TEXT, entry TEXT, data TEXT NOT NULL,
        evidence TEXT NOT NULL, conflict INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(session,entry));
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, path TEXT NOT NULL,
        agent TEXT, project TEXT, feature TEXT, parent TEXT);
      CREATE TABLE IF NOT EXISTS imports (id INTEGER PRIMARY KEY, report TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS manual_prices (
        provider TEXT NOT NULL, model TEXT NOT NULL, category TEXT NOT NULL,
        currency TEXT NOT NULL, effectiveFrom TEXT NOT NULL, ratePerMillion TEXT NOT NULL,
        PRIMARY KEY(provider,model,category,currency,effectiveFrom));
      COMMIT;`),
    );
    db.prepare("INSERT OR IGNORE INTO config VALUES (?,?)").run(
      "fingerprint-key",
      randomBytes(32).toString("hex"),
    );
  } catch (error) {
    db.close();
    throw error;
  }
  const secret = db
    .prepare("SELECT value FROM config WHERE key=?")
    .get("fingerprint-key").value;
  const read = (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      throw new Error("Explicit source could not be read");
    }
  };
  const readTransaction = (fn) => {
    db.exec("BEGIN DEFERRED");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  const snapshot = () => {
    const sources = db.prepare("SELECT * FROM sources").all();
    const entries = db
      .prepare("SELECT * FROM entries")
      .all()
      .map((row) => ({
        ...storedJson(row.data),
        session: row.session,
        entry: row.entry,
        evidence: row.evidence,
        conflict: row.conflict,
      }));
    const byPath = new Map(sources.map((row) => [row.path, row]));
    const byEntry = new Map(
      entries.map((row) => [JSON.stringify([row.session, row.entry]), row]),
    );
    const classify = (row, visited = new Set()) => {
      if (row.conflict) return "identity-conflict";
      const files = sources.filter((source) => source.session === row.session);
      if (files.length !== 1) return "session-ambiguous";
      if (visited.has(row.session)) return "lineage-unresolved";
      // Validate source ancestry even when no retained entry IDs match.
      const seen = new Set([row.session]);
      let ancestor = files[0];
      while (ancestor.parent) {
        ancestor = byPath.get(ancestor.parent);
        if (!ancestor || seen.has(ancestor.session))
          return "lineage-unresolved";
        if (
          sources.filter((source) => source.session === ancestor.session)
            .length !== 1
        )
          return "session-ambiguous";
        seen.add(ancestor.session);
      }
      const parentPath = files[0].parent;
      if (!parentPath) return row.certainty;
      const parent = byPath.get(parentPath);
      if (!parent) return "lineage-unresolved";
      const copied = byEntry.get(JSON.stringify([parent.session, row.entry]));
      // Absence in an earlier import is not origin evidence: parents can grow.
      // Header/entry times alone do not prove that a record was not copied later.
      if (!copied) return "lineage-unresolved";
      if (!row.timestamp || copied.evidence !== row.evidence)
        return "lineage-conflict";
      const ancestry = classify(copied, new Set([...visited, row.session]));
      return ["own", "copied", "nested-unknown", "incomplete"].includes(
        ancestry,
      )
        ? "copied"
        : ancestry;
    };
    return entries.map((row) => {
      const { evidence: _evidence, conflict: _conflict, ...safe } = row;
      return { ...safe, certainty: classify(row) };
    });
  };
  const attribution = (session) => {
    const rows = db
      .prepare(`SELECT t.* FROM tasks t JOIN sources s ON s.path=t.path
      WHERE s.session=?`)
      .all(session);
    const consensus = (key) => {
      const values = new Set(rows.map((row) => row[key]));
      return values.size === 1 && !values.has(null)
        ? [...values][0]
        : "unknown";
    };
    return {
      agent: consensus("agent"),
      project: consensus("project"),
      feature: consensus("feature"),
      parent: consensus("parent"),
      actor: consensus("agent") === "unknown" ? "unknown" : "agent",
    };
  };
  return {
    db,
    close: () => db.close(),
    attribution,
    addManualPrice: (value) => {
      const price = validateManual(value, manualKeys);
      const key = manualKeys.slice(0, -1).map((field) => price[field]);
      let stored;
      try {
        // Unique-key arbitration is atomic across handles; existing rates never update.
        db.prepare(`INSERT INTO manual_prices VALUES (?,?,?,?,?,?)
          ON CONFLICT(provider,model,category,currency,effectiveFrom) DO NOTHING`).run(
          ...key,
          price.ratePerMillion,
        );
        stored = db
          .prepare(`SELECT * FROM manual_prices
          WHERE provider=? AND model=? AND category=? AND currency=? AND effectiveFrom=?`)
          .get(...key);
      } catch {
        throw new Error("Manual price operation failed");
      }
      if (stored.ratePerMillion !== price.ratePerMillion)
        throw new Error("Manual price conflict");
      return { ...stored };
    },
    manualPrices: (value) => {
      const query = validateManual(value, ["provider", "model", "currency"]);
      try {
        return db
          .prepare(`SELECT * FROM manual_prices
          WHERE provider=? AND model=? AND currency=? ORDER BY category,effectiveFrom`)
          .all(query.provider, query.model, query.currency)
          .map((row) => ({ ...row }));
      } catch {
        throw new Error("Manual price operation failed");
      }
    },
    quoteManual: (value) => {
      const query = validateManual(
        value,
        ["provider", "model", "currency", "at", "usage"],
        "Invalid manual quote",
      );
      let prices;
      try {
        prices = db
          .prepare(`SELECT * FROM manual_prices
          WHERE provider=? AND model=? AND currency=? AND effectiveFrom<=?
          ORDER BY category,effectiveFrom`)
          .all(query.provider, query.model, query.currency, query.at);
      } catch {
        throw new Error("Manual quote operation failed");
      }
      const selected = new Map(prices.map((row) => [row.category, { ...row }]));
      const categories = {};
      const missingCounters = [];
      const missingPrices = [];
      let total = 0n;
      for (const category of priceCategories) {
        const tokens = Object.hasOwn(query.usage, category)
          ? query.usage[category]
          : null;
        const price = selected.get(category) ?? null;
        if (tokens === null) missingCounters.push(category);
        if (price === null) missingPrices.push(category);
        const scaled =
          tokens !== null && price !== null
            ? BigInt(price.ratePerMillion.replace(".", "")) * BigInt(tokens)
            : null;
        categories[category] = {
          tokens,
          price,
          amount: scaled === null ? null : fixedAmount(scaled),
        };
        if (scaled !== null) total += scaled;
      }
      const complete =
        missingCounters.length === 0 && missingPrices.length === 0;
      return {
        provider: query.provider,
        model: query.model,
        currency: query.currency,
        at: query.at,
        provenance: "manual-quote",
        categories,
        coverage: { complete, missingCounters, missingPrices },
        total: complete ? fixedAmount(total) : null,
      };
    },
    entries: () => readTransaction(snapshot),
    accounting: () =>
      readTransaction(() => {
        const rows = snapshot();
        const uncertain = rows.filter(
          (row) => !["own", "copied"].includes(row.certainty),
        );
        const categories = [
          "input",
          "output",
          "cacheRead",
          "cacheWrite",
          "totalTokens",
          "reasoning",
          "cacheWrite1h",
        ];
        const agents = new Map();
        const tasks = db
          .prepare(`SELECT s.session,t.agent FROM tasks t
          JOIN sources s ON s.path=t.path`)
          .all();
        for (const task of tasks) {
          if (!agents.has(task.session)) agents.set(task.session, new Set());
          agents.get(task.session).add(task.agent);
        }
        const evidence = (session) => {
          const values = agents.get(session);
          if (!values) return "no-task";
          const known = [...values].filter((value) => value !== null);
          if (known.length > 1) return "conflicting-agents";
          if (values.has(null)) return "missing-agent";
          return "task-consensus";
        };
        const groups = new Map();
        for (const row of rows) {
          const attributionEvidence = evidence(row.session);
          const key = JSON.stringify([
            row.operation,
            row.certainty,
            attributionEvidence,
          ]);
          if (!groups.has(key)) {
            groups.set(key, {
              operation: row.operation,
              certainty: row.certainty,
              attributionEvidence,
              entries: 0,
              additive: false,
              observed: Object.fromEntries(
                categories.map((key) => [key, null]),
              ),
              missing: Object.fromEntries(categories.map((key) => [key, 0])),
            });
          }
          const group = groups.get(key);
          group.entries++;
          for (const category of categories) {
            if (row[category] === null) group.missing[category]++;
            else
              group.observed[category] =
                (group.observed[category] ?? 0) + row[category];
          }
        }
        return {
          breakdown: [...groups.values()],
          certainties: Object.fromEntries(
            [...new Set(rows.map((row) => row.certainty))].map((certainty) => [
              certainty,
              rows.filter((row) => row.certainty === certainty).length,
            ]),
          ),
          uncertain: {
            entries: uncertain.length,
            additive: false,
            observed: Object.fromEntries(
              categories.map((key) => [
                key,
                uncertain.reduce((sum, row) => sum + (row[key] ?? 0), 0),
              ]),
            ),
            missing: Object.fromEntries(
              categories.map((key) => [
                key,
                uncertain.filter((row) => row[key] === null).length,
              ]),
            ),
          },
        };
      }),
    coverage: () =>
      db
        .prepare("SELECT report FROM imports ORDER BY id")
        .all()
        .map((row) => storedJson(row.report)),
    importFiles({ sessions = [], tasks = [] } = {}) {
      const report = {
        malformed: 0,
        incomplete: 0,
        pending: 0,
        conflicts: 0,
        inserted: 0,
        duplicates: 0,
        ignored: 0,
        unresolved: 0,
      };
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const path of sessions) {
          const lines = read(path).split("\n");
          let session;
          for (const line of lines) {
            if (!line.trim()) continue;
            let entry;
            try {
              entry = JSON.parse(line);
            } catch {
              report.malformed++;
              continue;
            }
            if (!entry || typeof entry !== "object") {
              report.malformed++;
              continue;
            }
            if (!session) {
              if (
                entry.type !== "session" ||
                !text(entry.id) ||
                ![2, 3].includes(entry.version)
              ) {
                break;
              }
              session = entry.id;
              const key = pathKey(path);
              const parent = text(entry.parentSession)
                ? pathKey(resolve(dirname(path), entry.parentSession))
                : null;
              const old = db
                .prepare("SELECT * FROM sources WHERE path=?")
                .get(key);
              if (old && (old.session !== session || old.parent !== parent))
                throw new Error("Source identity changed");
              db.prepare("INSERT OR IGNORE INTO sources VALUES (?,?,?)").run(
                key,
                session,
                parent,
              );
              continue;
            }
            const normalized = normalize(entry, secret);
            if (!normalized) {
              report.ignored++;
              continue;
            }
            if (normalized.pending) {
              report.pending++;
              continue;
            }
            if (!text(entry.id)) {
              report.incomplete++;
              continue;
            }
            if (normalized.data.certainty === "incomplete") report.incomplete++;
            const old = db
              .prepare("SELECT * FROM entries WHERE session=? AND entry=?")
              .get(session, entry.id);
            if (old) {
              if (old.evidence === normalized.evidence) report.duplicates++;
              else {
                db.prepare(
                  "UPDATE entries SET conflict=1 WHERE session=? AND entry=?",
                ).run(session, entry.id);
                report.conflicts++;
              }
            } else {
              db.prepare(
                "INSERT INTO entries(session,entry,data,evidence) VALUES (?,?,?,?)",
              ).run(
                session,
                entry.id,
                JSON.stringify(normalized.data),
                normalized.evidence,
              );
              report.inserted++;
            }
          }
          if (!session) report.incomplete++;
        }
        for (const path of tasks) {
          const content = read(path);
          let task;
          try {
            task = JSON.parse(content).task;
          } catch {
            report.malformed++;
            continue;
          }
          if (!text(task?.id) || !text(task?.sessionPath)) {
            report.incomplete++;
            continue;
          }
          db.prepare(`INSERT INTO tasks VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
            path=excluded.path,agent=excluded.agent,project=excluded.project,
            feature=excluded.feature,parent=excluded.parent`).run(
            task.id,
            pathKey(resolve(dirname(path), task.sessionPath)),
            text(task.agent),
            text(task.project) ??
              (text(task.cwd) ? `workspace:${pathKey(task.cwd)}` : null),
            text(task.feature),
            text(task.parentSessionId),
          );
        }
        const current = snapshot();
        report.unresolved = current.filter(
          (row) => row.certainty === "lineage-unresolved",
        ).length;
        report.certainties = Object.fromEntries(
          [...new Set(current.map((row) => row.certainty))].map((certainty) => [
            certainty,
            current.filter((row) => row.certainty === certainty).length,
          ]),
        );
        db.prepare("INSERT INTO imports(report) VALUES (?)").run(
          JSON.stringify(report),
        );
        db.exec("COMMIT");
        return report;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    ranking() {
      return readTransaction(() => {
        const groups = new Map();
        for (const entry of snapshot()) {
          if (entry.certainty !== "own") continue;
          const actor = attribution(entry.session);
          if (!groups.has(actor.agent))
            groups.set(actor.agent, {
              agent: actor.agent,
              tokens: 0,
              runtimeEstimate: null,
              missingEstimates: 0,
              estimateProvenance: "runtime-estimate",
              sessions: new Set(),
            });
          const group = groups.get(actor.agent);
          group.tokens += entry.totalTokens;
          group.sessions.add(entry.session);
          if (entry.runtimeEstimate === null) group.missingEstimates++;
          else
            group.runtimeEstimate =
              (group.runtimeEstimate ?? 0) + entry.runtimeEstimate;
        }
        return [...groups.values()]
          .map((group) => ({ ...group, sessions: group.sessions.size }))
          .sort(
            (a, b) => b.tokens - a.tokens || a.agent.localeCompare(b.agent),
          );
      });
    },
  };
}
