const help = `Usage: node src/cli.js import [--db path] --session path [--session path ...]
       node src/cli.js import [--db path] --task path [--task path ...]
       node src/cli.js report --db existing.sqlite [--session id]
       node src/cli.js costs --db existing.sqlite --currency USD
Import sessions and tasks may be combined; file flags are repeatable.
Only explicitly selected files are read.
Report --session: one literal nonempty ID, at most 512 UTF-16 code units.
Values starting with -- are rejected; --flag=value syntax is not supported.
Default database: ~/.local/state/pi-usage-audit/usage.sqlite
--help: show help without opening storage.
`;
function parse(args) {
  if (args.length === 1 && args[0] === "--help") return { help: true };
  if (!["import", "report", "costs"].includes(args[0]))
    throw new Error("arguments");
  const options = { command: args[0], sessions: [], tasks: [] };
  for (let i = 1; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--help") {
      options.help = true;
      continue;
    }
    if (
      !(
        options.command === "costs"
          ? ["--db", "--currency"]
          : options.command === "report"
            ? ["--db", "--session"]
            : ["--db", "--session", "--task"]
      ).includes(flag)
    )
      throw new Error("arguments");
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error("arguments");
    if (flag === "--db") {
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
      if (options.session !== undefined || value.length > 512)
        throw new Error("arguments");
      options.session = value;
    } else options[flag === "--session" ? "sessions" : "tasks"].push(value);
  }
  if (
    !options.help &&
    (options.command === "import"
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
else if (options) {
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
      console.log(
        JSON.stringify(
          ledger.runtimeReport(
            options.session === undefined ? {} : { session: options.session },
          ),
        ),
      );
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
