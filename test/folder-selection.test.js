import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { selectFolderSources } from "../src/folder-selection.js";

const empty = { sessions: [], tasks: [] };
function rejects(config, fs) {
  assert.throws(
    () => selectFolderSources(config, fs),
    /^Error: Folder selection failed\.$/,
  );
}

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "folder-selection-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sessions = join(dir, "sessions");
  const tasks = join(dir, "tasks");
  mkdirSync(sessions);
  mkdirSync(tasks);
  return { dir, sessions, tasks };
}

function fake(names, failRead = false) {
  const calls = [];
  return {
    calls,
    fs: {
      lstatSync: (path) => {
        calls.push(path);
        const file = /\.(jsonl|json)$/.test(path);
        return {
          isSymbolicLink: () => false,
          isDirectory: () => !file,
          isFile: () => file,
        };
      },
      opendirSync: () => {
        calls.push("opened");
        let index = 0;
        return {
          readSync: () => {
            if (failRead) throw Error("PRIVATE_LOCATION");
            return index < names.length ? { name: names[index++] } : null;
          },
          closeSync: () => calls.push("closed"),
        };
      },
    },
  };
}

test("direct sorted files; no recursion, content reads or locator traversal", (t) => {
  const f = fixture(t);
  const other = join(f.dir, "other");
  mkdirSync(other);
  for (const name of ["z.jsonl", "a.jsonl", "ignored.JSONL", "notes.txt"])
    writeFileSync(join(f.sessions, name), "not-json");
  mkdirSync(join(f.sessions, "nested.jsonl"));
  writeFileSync(join(f.sessions, "nested.jsonl", "hidden.jsonl"), "private");
  writeFileSync(join(other, "b.jsonl"), "not-json");
  writeFileSync(join(f.tasks, "task.json"), "malformed-unapproved-locator");
  const result = selectFolderSources({
    sessionsDirs: [f.sessions, other, resolve(f.sessions, ".")],
    tasksDirs: [f.tasks],
  });
  assert.deepEqual(result, {
    sessions: [
      join(other, "b.jsonl"),
      join(f.sessions, "a.jsonl"),
      join(f.sessions, "z.jsonl"),
    ],
    tasks: [join(f.tasks, "task.json")],
  });
  assert.deepEqual(selectFolderSources({ sessionsDirs: [f.tasks] }), empty);
  writeFileSync(join(f.sessions, "new.jsonl"), "new-content");
  const refreshed = selectFolderSources({ sessionsDirs: [f.sessions] });
  assert.ok(refreshed.sessions.includes(join(f.sessions, "new.jsonl")));
});

test("configuration admission precedes all filesystem access", (t) => {
  const f = fixture(t);
  const probe = fake([]);
  const bad = [
    null,
    [],
    {},
    { sessionsDirs: [] },
    { sessionsDirs: ["relative"] },
    { sessionsDirs: new Array(1) },
    { sessionsDirs: [f.sessions + "\0"] },
    { sessionsDirs: [f.sessions], tasksDirs: [null] },
    { sessionsDirs: [f.sessions], recursive: true },
    { sessionsDirs: [f.sessions], [Symbol("extra")]: true },
    { sessionsDirs: Array(33).fill(f.sessions) },
    Object.create({ sessionsDirs: [f.sessions] }),
  ];
  if (process.platform === "win32") {
    for (const path of [
      "\\sessions",
      "C:sessions",
      "\\\\?\\C:\\sessions",
      "\\\\.\\device",
    ])
      bad.push({ sessionsDirs: [path] });
  }
  for (const config of bad) rejects(config, probe.fs);
  assert.equal(probe.calls.length, 0);
});

test("empty, missing and non-directory folders", (t) => {
  const f = fixture(t);
  assert.deepEqual(
    selectFolderSources({
      sessionsDirs: [f.sessions],
      tasksDirs: [f.tasks],
    }),
    empty,
  );
  const file = join(f.dir, "file.jsonl");
  writeFileSync(file, "content");
  for (const path of [join(f.dir, "missing"), file])
    rejects({ sessionsDirs: [path] });
});

test("exact limits and overflow never silently truncate sources", () => {
  const root = resolve("synthetic-root");
  const config = { sessionsDirs: Array(32).fill(root), tasksDirs: [] };
  for (const count of [1000, 1001]) {
    const names = Array.from({ length: count }, (_, i) => `${i}.jsonl`);
    const probe = fake(names);
    if (count === 1000) {
      assert.equal(
        selectFolderSources(config, probe.fs).sessions.length,
        count,
      );
    } else rejects(config, probe.fs);
    assert.equal(probe.calls.at(-1), "closed");
  }
  for (const count of [10_000, 10_001]) {
    const probe = fake(Array(count).fill("ignore.txt"));
    if (count === 10_000) {
      assert.deepEqual(selectFolderSources(config, probe.fs), empty);
    } else rejects(config, probe.fs);
    assert.equal(probe.calls.at(-1), "closed");
  }
});

test("shared roles scan once; all roots are admitted before enumeration", () => {
  const root = resolve("synthetic-root");
  const config = { sessionsDirs: [root], tasksDirs: [root] };
  const probe = fake(["a.jsonl", "t.json"]);
  const result = selectFolderSources(config, probe.fs);
  assert.equal(result.sessions.length, 1);
  assert.equal(result.tasks.length, 1);
  assert.equal(probe.calls.filter((call) => call === "opened").length, 1);
  const blocked = fake([]);
  blocked.fs.lstatSync = () => {
    throw Error("PRIVATE_ROOT");
  };
  rejects(config, blocked.fs);
  assert.equal(blocked.calls.includes("opened"), false);
});

test("enumeration errors close the directory and stay sanitized", () => {
  const probe = fake([], true);
  rejects({ sessionsDirs: [resolve("synthetic-root")] }, probe.fs);
  assert.equal(probe.calls.at(-1), "closed");
});

test("matching links and nonregular files fail with deterministic metadata", () => {
  for (const link of [true, false]) {
    const probe = fake(["source.jsonl"]);
    const original = probe.fs.lstatSync;
    probe.fs.lstatSync = (path) => {
      if (!path.endsWith(".jsonl")) return original(path);
      return {
        isSymbolicLink: () => link,
        isDirectory: () => false,
        isFile: () => false,
      };
    };
    rejects({ sessionsDirs: [resolve("synthetic-root")] }, probe.fs);
    assert.equal(probe.calls.at(-1), "closed");
  }
});

for (const kind of ["root", "ancestor", "file"]) {
  test(`rejects ${kind} links without following them`, (t) => {
    const f = fixture(t);
    const link = join(f.dir, "linked");
    let config;
    try {
      if (kind === "file") {
        const outside = join(f.dir, "outside.jsonl");
        writeFileSync(outside, "private");
        symlinkSync(outside, join(f.sessions, "linked.jsonl"), "file");
        config = { sessionsDirs: [f.sessions] };
      } else {
        mkdirSync(join(f.sessions, "child"));
        symlinkSync(f.sessions, link, "junction");
        const path = kind === "root" ? link : join(link, "child");
        config = { sessionsDirs: [path] };
      }
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
        t.skip("Host does not permit this link type");
        return;
      }
      throw error;
    }
    rejects(config);
  });
}
