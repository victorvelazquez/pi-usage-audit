import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  loadLocalSettings,
  validateLocalSettings,
} from "../src/local-settings.js";

const failure = { message: "Local settings unavailable." };
const limit = 64 * 1024;

function fixture(t) {
  const dir = fs.mkdtempSync(join(tmpdir(), "local-settings-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = join(dir, "settings.json");
  const settings = {
    db: join(dir, "usage.sqlite"),
    currency: "EUR",
    sessionsDirs: [join(dir, "absent-sessions")],
  };
  const encoded = JSON.stringify({ version: 1, settings });
  fs.writeFileSync(filename, encoded);
  return { dir, filename, settings, encoded };
}

test("pure settings admission copies paths and defaults only omissions", (t) => {
  const f = fixture(t);
  const expected = {
    ...f.settings,
    sessionsDirs: [...f.settings.sessionsDirs],
    tasksDirs: [],
    mode: 10,
  };
  const copy = validateLocalSettings(f.settings);
  assert.deepEqual(copy, expected);
  f.settings.sessionsDirs.push(join(f.dir, "later"));
  assert.deepEqual(copy, expected);
  assert.equal(fs.existsSync(f.settings.db), false);
  for (const mode of [5, 10, 30, "paused"]) {
    assert.equal(validateLocalSettings({ ...expected, mode }).mode, mode);
  }
});

test("settings reject unknown, inherited, mixed and invalid values", (t) => {
  const f = fixture(t);
  for (const patch of [
    { db: "relative" },
    { db: `${f.settings.db}\0` },
    { currency: "eur" },
    { mode: 0 },
    { mode: "10" },
    { mode: undefined },
    { tasksDirs: undefined },
    { tasksDirs: new Array(1) },
    { sessionsDirs: [] },
    { sessionsDirs: Array(33).fill(f.dir) },
    { sessions: [] },
    { extra: true },
    { [Symbol("extra")]: true },
  ]) {
    assert.throws(
      () => validateLocalSettings({ ...f.settings, ...patch }),
      failure,
    );
  }
  const { db, ...rest } = f.settings;
  assert.throws(
    () => validateLocalSettings(Object.assign(Object.create({ db }), rest)),
    failure,
  );
  for (const value of [null, [], "settings"]) {
    assert.throws(() => validateLocalSettings(value), failure);
  }
});

test("load touches only the explicit settings file, not source folders or DB", (t) => {
  const f = fixture(t);
  const touched = [];
  const deps = {
    ...fs,
    lstatSync(path) {
      touched.push(path);
      return fs.lstatSync(path);
    },
  };
  assert.deepEqual(loadLocalSettings(f.filename, deps), {
    ...f.settings,
    tasksDirs: [],
    mode: 10,
  });
  for (const path of [f.settings.db, ...f.settings.sessionsDirs]) {
    assert.equal(touched.includes(path), false);
    assert.equal(fs.existsSync(path), false);
  }
  assert.throws(() => loadLocalSettings("relative"), failure);
  assert.throws(() => loadLocalSettings(join(f.dir, "missing")), failure);
  assert.throws(() => loadLocalSettings(f.dir), failure);
});

test("strict versioned envelope and fatal UTF-8 reject corrupt settings", (t) => {
  const f = fixture(t);
  for (const bytes of [
    "{",
    "null",
    JSON.stringify({ settings: f.settings }),
    JSON.stringify({ version: 2, settings: f.settings }),
    JSON.stringify({ version: 1, settings: f.settings, extra: true }),
    JSON.stringify({ version: 1, settings: { ...f.settings, db: f.filename } }),
    Buffer.from([0xff]),
    `\ufeff${f.encoded}`,
  ]) {
    fs.writeFileSync(f.filename, bytes);
    assert.throws(() => loadLocalSettings(f.filename), failure);
  }
});

test("encoded byte cap is inclusive and bounded even with short or growing reads", (t) => {
  const f = fixture(t);
  const padded = f.encoded + " ".repeat(limit - Buffer.byteLength(f.encoded));
  fs.writeFileSync(f.filename, padded);
  assert.equal(loadLocalSettings(f.filename).currency, "EUR");
  fs.appendFileSync(f.filename, " ");
  assert.throws(() => loadLocalSettings(f.filename), failure);
  fs.writeFileSync(f.filename, f.encoded);
  let consumed = 0;
  const growing = {
    ...fs,
    readSync(_fd, buffer, offset, length) {
      const count = Math.min(7, length);
      buffer.fill(32, offset, offset + count);
      consumed += count;
      return count;
    },
  };
  assert.throws(() => loadLocalSettings(f.filename, growing), failure);
  assert.equal(consumed, limit + 1);
  const short = {
    ...fs,
    readSync(fd, buffer, offset, length, position) {
      return fs.readSync(fd, buffer, offset, Math.min(7, length), position);
    },
  };
  assert.equal(loadLocalSettings(f.filename, short).currency, "EUR");
});

test("metadata links reject before content opening and replacement rejects before reading", (t) => {
  const f = fixture(t);
  for (const linked of [f.filename, dirname(f.filename)]) {
    let opens = 0;
    const deps = {
      ...fs,
      lstatSync(path) {
        const stat = fs.lstatSync(path);
        if (path === linked) stat.isSymbolicLink = () => true;
        return stat;
      },
      openSync() {
        opens++;
        throw new Error("private path");
      },
    };
    assert.throws(() => loadLocalSettings(f.filename, deps), failure);
    assert.equal(opens, 0);
  }
  let reads = 0;
  const replaced = {
    ...fs,
    fstatSync(fd) {
      const stat = fs.fstatSync(fd);
      stat.ino += 1;
      return stat;
    },
    readSync() {
      reads++;
    },
  };
  assert.throws(() => loadLocalSettings(f.filename, replaced), failure);
  assert.equal(reads, 0);
});

test("native linked ancestor is rejected", (t) => {
  const f = fixture(t);
  const linked = join(f.dir, "link");
  try {
    fs.symlinkSync(
      f.dir,
      linked,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (!["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) throw error;
    t.skip("Host does not permit creating directory links");
    return;
  }
  assert.throws(
    () => loadLocalSettings(join(linked, "settings.json")),
    failure,
  );
});

test("descriptors close on read, stat and close errors without exposing raw errors", (t) => {
  const f = fixture(t);
  for (const method of ["readSync", "fstatSync", "closeSync"]) {
    let closes = 0;
    const deps = {
      ...fs,
      [method]() {
        throw new Error(f.filename);
      },
      closeSync(fd) {
        closes++;
        fs.closeSync(fd);
        if (method === "closeSync") throw new Error(f.filename);
      },
    };
    assert.throws(() => loadLocalSettings(f.filename, deps), failure);
    assert.equal(closes, 1);
    assert.equal(fs.readFileSync(f.filename, "utf8"), f.encoded);
  }
});
