import { lstatSync, opendirSync } from "node:fs";
import { resolve, isAbsolute, parse, sep } from "node:path";

const failure = () => {
  throw new Error("Folder selection failed.");
};
const key = (path) =>
  process.platform === "win32" ? path.toLowerCase() : path;

function absoluteDirectory(value) {
  if (typeof value !== "string" || value.includes("\0") || !isAbsolute(value))
    return false;
  if (process.platform !== "win32") return true;
  if (/^[\\/]{2}[?.][\\/]/.test(value)) return false;
  return /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+(?:[\\/]|$))/.test(
    value,
  );
}

function directories(value, required = false) {
  if (!Array.isArray(value) || value.length > 32 || (required && !value.length))
    failure();
  const copy = Array.from(value);
  if (!copy.every(absoluteDirectory)) failure();
  return copy.map((path) => resolve(path));
}

// Metadata admission only. Concurrent replacements can invalidate this snapshot;
// later import must revalidate sources, not treat these paths as capabilities.
function inspect(path, directory, fs) {
  const root = parse(path).root;
  const parts = path.slice(root.length).split(sep).filter(Boolean);
  let current = root;
  const ancestors = [root];
  for (const part of parts) {
    current = resolve(current, part);
    ancestors.push(current);
  }
  for (let i = 0; i < ancestors.length; i++) {
    const stat = fs.lstatSync(ancestors[i]);
    if (stat.isSymbolicLink()) failure();
    if (i < ancestors.length - 1 || directory) {
      if (!stat.isDirectory()) failure();
    } else return stat;
  }
}

function roleFor(name, roles) {
  if (roles.has("sessions") && name.endsWith(".jsonl")) return "sessions";
  if (roles.has("tasks") && name.endsWith(".json")) return "tasks";
  return null;
}

function sorted(paths) {
  return [...paths.keys()].sort().map((identity) => paths.get(identity));
}

// Pure admission shared by selection and the lazy update adapter.
export function validateFolderConfig(options) {
  try {
    if (
      !options ||
      typeof options !== "object" ||
      Array.isArray(options) ||
      !Object.hasOwn(options, "sessionsDirs") ||
      Reflect.ownKeys(options).some(
        (name) => !["sessionsDirs", "tasksDirs"].includes(name),
      )
    )
      failure();
    const sessionsDirs = directories(options.sessionsDirs, true);
    const tasksDirs = directories(
      Object.hasOwn(options, "tasksDirs") && options.tasksDirs !== undefined
        ? options.tasksDirs
        : [],
    );
    if (sessionsDirs.length + tasksDirs.length > 32) failure();
    return { sessionsDirs, tasksDirs };
  } catch {
    failure();
  }
}

// Direct entries only: no home defaults, content reads, locators or recursion.
// The filesystem argument is an internal deterministic-test seam, not user config.
export function selectFolderSources(options, fs = { lstatSync, opendirSync }) {
  try {
    const { sessionsDirs, tasksDirs } = validateFolderConfig(options);
    if (
      typeof fs.lstatSync !== "function" ||
      typeof fs.opendirSync !== "function"
    )
      failure();
    const roots = new Map();
    for (const [paths, role] of [
      [sessionsDirs, "sessions"],
      [tasksDirs, "tasks"],
    ]) {
      for (const path of paths) {
        const identity = key(path);
        if (!roots.has(identity))
          roots.set(identity, { path, roles: new Set() });
        roots.get(identity).roles.add(role);
      }
    }
    // Admit every declared root before enumerating any source directory.
    for (const { path } of roots.values()) inspect(path, true, fs);
    const selected = { sessions: new Map(), tasks: new Map() };
    let examined = 0;
    let count = 0;
    for (const { path, roles } of roots.values()) {
      const directory = fs.opendirSync(path);
      try {
        let entry;
        while ((entry = directory.readSync()) !== null) {
          if (++examined > 10_000) failure();
          const role = roleFor(entry.name, roles);
          if (role === null) continue;
          const filename = resolve(path, entry.name);
          const stat = inspect(filename, false, fs);
          if (stat.isDirectory()) continue;
          if (!stat.isFile()) failure();
          const identity = key(filename);
          if (!selected[role].has(identity)) {
            if (++count > 1000) failure();
            selected[role].set(identity, filename);
          }
        }
      } finally {
        directory.closeSync();
      }
    }
    return {
      sessions: sorted(selected.sessions),
      tasks: sorted(selected.tasks),
    };
  } catch {
    failure();
  }
}
