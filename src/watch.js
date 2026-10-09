import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const text = (value) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 512;
const decode = (bytes) =>
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const failure = (index) =>
  new Error(`Watch failed${index === undefined ? "" : ` at source ${index}`}.`);
function selected(index, read) {
  try {
    return read();
  } catch {
    throw failure(index);
  }
}
function parse(content, index) {
  try {
    return JSON.parse(content);
  } catch {
    throw failure(index);
  }
}
function sessionSnapshot(path, index) {
  return selected(index, () => {
    const bytes = readFileSync(path);
    const end = bytes.lastIndexOf(10) + 1;
    const rows = decode(bytes.subarray(0, end))
      .split("\n")
      .filter((row) => row.trim());
    const entries = rows.map((row) => parse(row, index));
    const header = entries[0];
    if (
      header?.type !== "session" ||
      !text(header.id) ||
      ![2, 3].includes(header.version) ||
      entries.some(
        (entry) => !entry || typeof entry !== "object" || Array.isArray(entry),
      )
    ) {
      throw failure(index);
    }
    return { path, bytes, end, header: rows[0], digest: hash(bytes) };
  });
}
function taskSnapshot(path, index) {
  return selected(index, () => {
    const content = decode(readFileSync(path));
    const task = parse(content, index).task;
    if (!text(task?.id) || !text(task?.sessionPath)) throw failure(index);
    return { path, content };
  });
}

// All selected sources are validated before the caller opens storage.
export function prepareWatch({ sessions, tasks = [] }) {
  let state = sessions.map(sessionSnapshot);
  let metadata = tasks.map((path, i) =>
    taskSnapshot(path, sessions.length + i),
  );
  let initial = true;
  let active = false;
  return {
    async cycle(ledger) {
      if (active) throw failure();
      active = true;
      try {
        const next = state.map((old, index) =>
          selected(index, () => {
            const bytes = readFileSync(old.path);
            if (
              bytes.length < old.bytes.length ||
              hash(bytes.subarray(0, old.bytes.length)) !== old.digest
            ) {
              throw failure(index);
            }
            const end = bytes.lastIndexOf(10) + 1;
            const added = decode(bytes.subarray(old.end, end));
            for (const row of added.split("\n")) {
              if (!row.trim()) continue;
              const entry = parse(row, index);
              if (
                !entry ||
                typeof entry !== "object" ||
                Array.isArray(entry) ||
                entry.type === "session"
              ) {
                throw failure(index);
              }
            }
            return { ...old, bytes, end, digest: hash(bytes), added };
          }),
        );
        const nextMetadata = tasks.map((path, i) =>
          taskSnapshot(path, sessions.length + i),
        );
        const changedTasks = nextMetadata.filter(
          (task, i) => initial || task.content !== metadata[i].content,
        );
        const snapshots = next
          .filter((source) => initial || source.added.trim())
          .map((source) => ({
            path: source.path,
            content: `${source.header}\n${source.added}`,
          }));
        let report = null;
        if (snapshots.length || changedTasks.length) {
          try {
            report = await ledger.importSnapshots({
              sessions: snapshots,
              tasks: changedTasks,
            });
          } catch {
            throw failure();
          }
        }
        // Prefixes and byte cursors become durable only after successful commit.
        state = next;
        metadata = nextMetadata;
        initial = false;
        return report;
      } finally {
        active = false;
      }
    },
  };
}

export async function runWatch({
  capture,
  ledger,
  emit,
  signals = process,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  let stopping = false;
  let timer;
  let wake;
  const stop = () => {
    stopping = true;
    if (timer !== undefined) cancel(timer);
    wake?.();
  };
  signals.on("SIGINT", stop);
  signals.on("SIGTERM", stop);
  let error;
  let counters;
  try {
    counters = await capture.cycle(ledger);
    emit({ event: "ready", counters });
    while (!stopping) {
      await new Promise((resolve) => {
        wake = resolve;
        timer = schedule(resolve, 1000);
      });
      timer = undefined;
      wake = undefined;
      if (stopping) break;
      const report = await capture.cycle(ledger);
      if (report) {
        counters = report;
        emit({ event: "imported", counters });
      }
    }
  } catch (caught) {
    error = caught;
  } finally {
    if (timer !== undefined) cancel(timer);
    signals.removeListener("SIGINT", stop);
    signals.removeListener("SIGTERM", stop);
    try {
      ledger.close();
    } catch {
      error = failure();
    }
  }
  if (error) throw error;
  emit({ event: "stopped", counters });
}

export async function watch(options, emit) {
  const capture = prepareWatch(options);
  const { openLedger } = await import("./ledger.js");
  let ledger;
  try {
    ledger = openLedger(options.db);
  } catch {
    throw failure();
  }
  await runWatch({ capture, ledger, emit });
}
