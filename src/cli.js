const help = `Usage: node src/cli.js import [--db path] --session path [--session path ...]
       node src/cli.js import [--db path] --task path [--task path ...]
       node src/cli.js watch --db path --session path [--session path ...] [--task path ...]
       node src/cli.js report --db existing.sqlite [--session id]
       node src/cli.js report --db existing.sqlite --project id
       node src/cli.js report --db existing.sqlite --task-id ID
       node src/cli.js costs --db existing.sqlite --currency USD
       node src/cli.js plan --root session.jsonl --tasks-dir dir --sessions-dir dir [--sessions-dir dir ...]
Plan requires one root, one tasks directory and at least one sessions directory.
Plan reads selected sources only; no storage or import. JSON importArgs is an argument array, not shell syntax.
Plan output contains local paths and task/session identifiers; do not publish it unredacted.
Import sessions and tasks may be combined; file flags are repeatable.
Only explicitly selected files are read.
Report --session: one literal nonempty ID, at most 512 UTF-16 code units.
Report --project: one literal case-sensitive ASCII ID [A-Za-z0-9_-], 1 to 64 characters.
Report --task-id: literal task ID, 1–512 UTF-16 units; linked session context, not exclusive consumption.
Report --session, --project and --task-id are mutually exclusive.
Values starting with -- are rejected; --flag=value syntax is not supported.
Default database: ~/.local/state/pi-usage-audit/usage.sqlite
--help: show help without opening storage.
`;
function parse(args) {
  if (args.length === 1 && args[0] === "--help") return { help: true };
  if (!["import", "report", "costs", "plan", "watch"].includes(args[0]))
    throw new Error("arguments");
  const options = {
    command: args[0],
    sessions: [],
    tasks: [],
    sessionsDirs: [],
  };
  for (let i = 1; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--help") {
      options.help = true;
      continue;
    }
    if (
      !(
        options.command === "plan"
          ? ["--root", "--tasks-dir", "--sessions-dir"]
          : options.command === "costs"
            ? ["--db", "--currency"]
            : options.command === "report"
              ? ["--db", "--session", "--project", "--task-id"]
              : ["--db", "--session", "--task"]
      ).includes(flag)
    )
      throw new Error("arguments");
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error("arguments");
    if (options.command === "plan") {
      if (flag === "--sessions-dir") {
        options.sessionsDirs.push(value);
      } else {
        const key = flag === "--root" ? "root" : "tasksDir";
        if (options[key] !== undefined) throw new Error("arguments");
        options[key] = value;
      }
    } else if (flag === "--db") {
      if (options.db !== undefined) throw new Error("arguments");
      options.db = value;
    } else if (flag === "--currency") {
      if (
        options.currency !== undefined ||
        !/^[A-Z]{3}$/.test(value) ||
        value.length !== 3
      )
        throw new Error("arguments");
      options.currency = value;
    } else if (options.command === "report" && flag === "--session") {
      if (
        options.session !== undefined ||
        options.taskId !== undefined ||
        options.projectId !== undefined ||
        value.length > 512
      )
        throw new Error("arguments");
      options.session = value;
    } else if (flag === "--task-id") {
      if (
        options.taskId !== undefined ||
        options.session !== undefined ||
        options.projectId !== undefined ||
        value.length > 512
      )
        throw new Error("arguments");
      options.taskId = value;
    } else if (flag === "--project") {
      if (
        options.projectId !== undefined ||
        options.taskId !== undefined ||
        options.session !== undefined ||
        value.length > 64 ||
        /[^A-Za-z0-9_-]/.test(value)
      )
        throw new Error("arguments");
      options.projectId = value;
    } else options[flag === "--session" ? "sessions" : "tasks"].push(value);
  }
  if (
    !options.help &&
    (options.command === "plan"
      ? options.root === undefined ||
        options.tasksDir === undefined ||
        !options.sessionsDirs.length
      : options.command === "watch"
        ? options.db === undefined || !options.sessions.length
        : options.command === "import"
          ? !options.sessions.length && !options.tasks.length
          : options.db === undefined ||
            (options.command === "costs" && options.currency === undefined))
  )
    throw new Error("arguments");
  return options;
}
let options;
try {
  options = parse(process.argv.slice(2));
} catch {
  console.error("Invalid arguments. Use --help.");
  process.exitCode = 2;
}
if (options?.help) process.stdout.write(help);
else if (options?.command === "plan") {
  try {
    const { selectSessionSources } = await import("./session-selection.js");
    console.log(
      JSON.stringify(
        selectSessionSources({
          root: options.root,
          tasksDir: options.tasksDir,
          sessionsDirs: options.sessionsDirs,
        }),
      ),
    );
  } catch {
    console.error("Session selection failed.");
    process.exitCode = 1;
  }
} else if (options?.command === "watch") {
  try {
    const { watch } = await import("./watch.js");
    await watch(options, (event) => console.log(JSON.stringify(event)));
  } catch (error) {
    console.error(
      /^Watch failed(?: at source \d+)?\.$/.test(error.message)
        ? error.message
        : "Watch failed.",
    );
    process.exitCode = 1;
  }
} else if (options) {
  let ledger;
  try {
    // Lazy loading also keeps help and parse errors free of SQLite initialization.
    if (options.command !== "import") {
      const { statSync } = await import("node:fs");
      if (!statSync(options.db).isFile()) throw new Error("database");
    }
    const { openLedger } = await import("./ledger.js");
    ledger = openLedger(options.db);
    if (options.command === "report") {
      const selection = {};
      for (const key of ["session", "projectId", "taskId"])
        if (options[key] !== undefined) selection[key] = options[key];
      console.log(JSON.stringify(ledger.runtimeReport(selection)));
    } else if (options.command === "costs") {
      console.log(
        JSON.stringify(ledger.costReport({ currency: options.currency })),
      );
    } else {
      const report = ledger.importFiles(options);
      console.log(
        JSON.stringify({
          report,
          ranking: ledger.ranking(),
          coverage: {
            imports: ledger.coverage(),
            accounting: ledger.accounting(),
          },
        }),
      );
    }
  } catch {
    console.error(
      options.command === "costs"
        ? "Cost report failed. Check database access."
        : options.command === "report"
          ? "Report failed. Check database access."
          : "Import failed. Check selected sources and database access.",
    );
    process.exitCode = 1;
  } finally {
    if (ledger) {
      try {
        ledger.close();
      } catch {
        console.error("Database close failed.");
        process.exitCode = 1;
      }
    }
  }
}
