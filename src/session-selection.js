import {
  lstatSync,
  realpathSync,
  readdirSync,
  readFileSync,
  openSync,
  readSync,
  closeSync,
} from "node:fs";
import { resolve, dirname, relative, isAbsolute, sep, parse } from "node:path";

const MiB = 1024 * 1024;
const fail = () => {
  throw new Error("Session selection failed.");
};
const text = (value) => typeof value === "string" && value.length > 0;
const id = (value) => text(value) && value.length <= 512;
// Match ledger path identity lexically, without probing unrelated locators.
const pathKey = (path) => {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
};
const within = (base, path) => {
  const tail = relative(pathKey(base), pathKey(path));
  return !isAbsolute(tail) && tail !== ".." && !tail.startsWith(`..${sep}`);
};

// Inspect every ancestor, including for absent children; never follow a link.
// These checks bound admission, not an absolute guarantee against concurrent swaps.
function inspect(path, kind, missing = false) {
  const base = parse(path).root;
  let current = base;
  const components = [
    base,
    ...path.slice(base.length).split(sep).filter(Boolean),
  ];
  for (let i = 0; i < components.length; i++) {
    if (i) current = resolve(current, components[i]);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (missing && error.code === "ENOENT") return null;
      throw error;
    }
    if (stat.isSymbolicLink()) fail();
    if (i < components.length - 1 && !stat.isDirectory()) fail();
    if (i === components.length - 1) {
      if (kind === "directory" ? !stat.isDirectory() : !stat.isFile()) fail();
      return { path: realpathSync.native(path), size: stat.size };
    }
  }
}

function sessionHeader(path, size) {
  // Read only the first JSONL record, not conversations or provider metadata.
  const fd = openSync(path, "r");
  const chunks = [];
  let offset = 0;
  try {
    while (offset < size) {
      const buffer = Buffer.alloc(Math.min(4096, size - offset));
      const count = readSync(fd, buffer, 0, buffer.length, offset);
      if (!count) break;
      const newline = buffer.subarray(0, count).indexOf(10);
      chunks.push(buffer.subarray(0, newline < 0 ? count : newline));
      if (newline >= 0) break;
      offset += count;
    }
  } finally {
    closeSync(fd);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (
      value?.type !== "session" ||
      ![2, 3].includes(value.version) ||
      !id(value.id)
    )
      fail();
    return value.id;
  } catch {
    fail();
  }
}

export function selectSessionSources(options) {
  try {
    if (
      !options ||
      Object.keys(options).sort().join(",") !== "root,sessionsDirs,tasksDir" ||
      !text(options.root) ||
      !text(options.tasksDir) ||
      !Array.isArray(options.sessionsDirs) ||
      !options.sessionsDirs.length ||
      !options.sessionsDirs.every(text)
    )
      fail();
    const root = inspect(resolve(options.root), "file");
    const tasksDir = inspect(resolve(options.tasksDir), "directory").path;
    const approved = options.sessionsDirs.map((path) => {
      const lexical = resolve(path);
      return { lexical, canonical: inspect(lexical, "directory").path };
    });
    const records = readdirSync(tasksDir)
      .filter((name) => name.endsWith(".json"))
      .sort();
    if (records.length > 1000) fail();
    const tasks = records.map((name) => {
      const file = inspect(resolve(tasksDir, name), "file");
      if (file.size > MiB) fail();
      const task = JSON.parse(readFileSync(file.path, "utf8"))?.task;
      const locator = text(task?.sessionPath)
        ? resolve(dirname(file.path), task.sessionPath)
        : null;
      const locatorKey = locator === null ? null : pathKey(locator);
      return { path: file.path, task, locator, locatorKey };
    });
    const sessions = [];
    const sessionIds = new Map();
    const headerIds = [];
    const locators = new Set();
    const absent = new Set();
    const taskIds = new Map();
    const selectedTasks = new Set();
    function signature({ task, locatorKey }) {
      if (
        !id(task?.id) ||
        !text(task.sessionPath) ||
        (task.parentSessionId !== undefined && !id(task.parentSessionId)) ||
        (task.agent !== undefined && !text(task.agent))
      )
        fail();
      return JSON.stringify([
        locatorKey,
        task.parentSessionId ?? null,
        task.agent ?? null,
      ]);
    }
    let bytes = 0;
    function addSession(file) {
      const key = pathKey(file.path);
      if (locators.has(key)) return;
      bytes += file.size;
      if (file.size > 64 * MiB || bytes > 256 * MiB || sessions.length >= 100)
        fail();
      const headerId = sessionHeader(file.path, file.size);
      if (sessionIds.has(headerId)) fail();
      sessionIds.set(headerId, file.path);
      locators.add(key);
      sessions.push(file.path);
      headerIds.push(headerId);
    }
    addSession(root);
    // Each newly admitted header expands the frontier. Unrelated locators are never probed.
    for (let frontier = 0; frontier < sessions.length; frontier++) {
      const frontierKey = pathKey(sessions[frontier]);
      for (const record of tasks) {
        if (selectedTasks.has(record.path)) continue;
        const { task, locator, locatorKey } = record;
        if (
          locatorKey !== frontierKey &&
          task?.parentSessionId !== headerIds[frontier]
        )
          continue;
        const identity = signature(record);
        if (taskIds.has(task.id) && taskIds.get(task.id) !== identity) fail();
        taskIds.set(task.id, identity);
        selectedTasks.add(record.path);
        if (locators.has(locatorKey) || absent.has(locatorKey)) continue;
        // Lexical admission must precede even lstat: out-of-scope missing paths fail too.
        const scopes = approved.filter((dir) => within(dir.lexical, locator));
        if (!scopes.length) fail();
        const file = inspect(locator, "file", true);
        if (!file) {
          absent.add(locatorKey);
          continue;
        }
        if (!scopes.some((dir) => within(dir.canonical, file.path))) fail();
        addSession(file);
      }
    }
    // Conflicting records of a selected task ID remain relevant even if unlinked.
    for (const record of tasks) {
      if (
        taskIds.has(record.task?.id) &&
        taskIds.get(record.task.id) !== signature(record)
      )
        fail();
    }
    const sources = {
      sessions,
      tasks: tasks
        .filter((row) => selectedTasks.has(row.path))
        .map((row) => row.path),
    };
    return {
      sources,
      importArgs: [
        ...sources.sessions.flatMap((path) => ["--session", path]),
        ...sources.tasks.flatMap((path) => ["--task", path]),
      ],
      coverage: {
        taskRecordsScanned: records.length,
        linkedTasksFound: sources.tasks.length,
        sessionsFound: sessions.length,
        linkedSessionsMissing: absent.size,
        missingReferencedTasks: null,
        importedSessions: 0,
        importedTasks: 0,
        referenceCoverage: "not-inspected",
        complete: false,
      },
    };
  } catch {
    fail();
  }
}
