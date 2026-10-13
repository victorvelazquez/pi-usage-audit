import { isAbsolute } from "node:path";
import { openLedger, openReadonlyLedger } from "./ledger.js";
import { createUpdateCoordinator } from "./update-coordinator.js";

function absoluteFile(value) {
  if (typeof value !== "string" || value.includes("\0") || !isAbsolute(value))
    return false;
  // Windows root-relative paths depend on the current drive, unlike full paths.
  return (
    process.platform !== "win32" ||
    /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+(?:[\\/]|$))/.test(value)
  );
}

function sourceList(value, required = false) {
  if (!Array.isArray(value) || (required && value.length === 0))
    throw new Error("Invalid ledger update configuration");
  const paths = Array.from(value);
  if (!paths.every(absoluteFile))
    throw new Error("Invalid ledger update configuration");
  return paths;
}

// Internal adapter for explicitly admitted files, not a directory discovery API.
export function createLedgerUpdateCoordinator(config, dependencies = {}) {
  const keys = ["db", "currency", "sessions", "tasks", "mode"];
  if (
    !config ||
    typeof config !== "object" ||
    Array.isArray(config) ||
    Reflect.ownKeys(config).some((key) => !keys.includes(key))
  )
    throw new Error("Invalid ledger update configuration");
  const { db, currency, mode = 10 } = config;
  if (
    !absoluteFile(db) ||
    typeof currency !== "string" ||
    !/^[A-Z]{3}$/.test(currency)
  )
    throw new Error("Invalid ledger update configuration");
  const sessions = sourceList(config.sessions, true);
  const tasks = sourceList(config.tasks === undefined ? [] : config.tasks);
  const {
    openWriter = openLedger,
    openReader = openReadonlyLedger,
    now = Date.now,
    schedule = setTimeout,
    cancel = clearTimeout,
  } = dependencies;
  if (typeof openWriter !== "function" || typeof openReader !== "function")
    throw new Error("Invalid ledger update callbacks");

  let importReport;
  return createUpdateCoordinator({
    mode,
    now,
    schedule,
    cancel,
    async importSources() {
      // openLedger may initialize storage even when later source reading fails.
      const writer = await openWriter(db);
      let result;
      try {
        result = await writer.importFiles({
          sessions: [...sessions],
          tasks: [...tasks],
        });
      } finally {
        await writer.close();
      }
      importReport = result;
    },
    async refreshReport() {
      // Open only after writer closure. This is one native joint read snapshot,
      // not a transaction spanning import and report or a browser-render receipt.
      const reader = await openReader(db);
      let dashboard;
      try {
        dashboard = await reader.dashboardReport({ currency });
      } finally {
        await reader.close();
      }
      // Preserve import counters: ready does not assert complete source coverage.
      // Raw internal data must use the existing projection before HTTP/UI exposure.
      return { dashboard, importReport };
    },
  });
}
