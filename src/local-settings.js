import * as fs from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { validateFolderConfig } from "./folder-selection.js";

const limit = 64 * 1024;
const failure = () => {
  throw new Error("Local settings unavailable.");
};

function absolutePath(value) {
  if (typeof value !== "string" || value.includes("\0") || !isAbsolute(value))
    return false;
  if (process.platform !== "win32") return true;
  if (/^[\\/]{2}[?.][\\/]/.test(value)) return false;
  return /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+(?:[\\/]|$))/.test(
    value,
  );
}

function shape(value, required, optional = []) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    required.every((key) => Object.hasOwn(value, key)) &&
    Reflect.ownKeys(value).every((key) =>
      [...required, ...optional].includes(key),
    )
  );
}

// Pure admission: declared folders and the database need not exist.
export function validateLocalSettings(settings) {
  try {
    if (
      !shape(
        settings,
        ["db", "currency", "sessionsDirs"],
        ["tasksDirs", "mode"],
      ) ||
      !absolutePath(settings.db) ||
      typeof settings.currency !== "string" ||
      !/^[A-Z]{3}$/.test(settings.currency) ||
      (Object.hasOwn(settings, "tasksDirs") && settings.tasksDirs === undefined)
    )
      failure();
    const mode = Object.hasOwn(settings, "mode") ? settings.mode : 10;
    if (![5, 10, 30, "paused"].includes(mode)) failure();
    const folders = validateFolderConfig({
      sessionsDirs: settings.sessionsDirs,
      tasksDirs: Object.hasOwn(settings, "tasksDirs") ? settings.tasksDirs : [],
    });
    return {
      db: resolve(settings.db),
      currency: settings.currency,
      ...folders,
      mode,
    };
  } catch {
    failure();
  }
}

function inspect(filename, filesystem) {
  const chain = [filename];
  let current = filename;
  while (dirname(current) !== current) {
    current = dirname(current);
    chain.push(current);
  }
  let target;
  for (let i = chain.length - 1; i >= 0; i--) {
    const stat = filesystem.lstatSync(chain[i]);
    if (stat.isSymbolicLink()) failure();
    if (i > 0) {
      if (!stat.isDirectory()) failure();
    } else {
      if (!stat.isFile() || stat.size > limit) failure();
      target = stat;
    }
  }
  return target;
}

// Explicit file only, no defaults or import. The filesystem seam is internal.
// Metadata/descriptor checks narrow races; they are not durable authorization.
export function loadLocalSettings(filename, filesystem = fs) {
  try {
    if (!absolutePath(filename)) failure();
    const path = resolve(filename);
    const target = inspect(path, filesystem);
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
    const fd = filesystem.openSync(path, flags);
    let text;
    try {
      const opened = filesystem.fstatSync(fd);
      if (
        !opened.isFile() ||
        opened.size > limit ||
        opened.dev !== target.dev ||
        opened.ino !== target.ino
      )
        failure();
      const bytes = Buffer.alloc(limit + 1);
      let total = 0;
      while (total < bytes.length) {
        const count = filesystem.readSync(
          fd,
          bytes,
          total,
          bytes.length - total,
          null,
        );
        if (count === 0) break;
        total += count;
      }
      if (total > limit) failure();
      // Preserve BOM for JSON.parse to reject; do not silently repair input.
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        bytes.subarray(0, total),
      );
    } finally {
      filesystem.closeSync(fd);
    }
    const envelope = JSON.parse(text);
    if (!shape(envelope, ["version", "settings"]) || envelope.version !== 1)
      failure();
    const settings = validateLocalSettings(envelope.settings);
    const key = (value) =>
      process.platform === "win32" ? value.toLowerCase() : value;
    if (key(settings.db) === key(path)) failure();
    return settings;
  } catch {
    failure();
  }
}
