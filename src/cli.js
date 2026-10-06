const help = `Usage: node src/cli.js import [--db path] --session path [--session path ...]
       node src/cli.js import [--db path] --task path [--task path ...]
       node src/cli.js report --db existing.sqlite
Sessions and tasks may be combined. Only explicitly selected files are read.
Default database: ~/.local/state/pi-usage-audit/usage.sqlite
--help: show help without opening storage.
`;
function parse(args) {
  if (args.length === 1 && args[0] === "--help") return { help: true };
  if (!["import", "report"].includes(args[0])) throw new Error("arguments");
  const options = { command: args[0], sessions: [], tasks: [] };
  for (let i = 1; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--help") {
      options.help = true;
      continue;
    }
    if (
      !(
        options.command === "report"
          ? ["--db"]
          : ["--db", "--session", "--task"]
      ).includes(flag)
    )
      throw new Error("arguments");
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error("arguments");
    if (flag === "--db") {
      if (options.db !== undefined) throw new Error("arguments");
      options.db = value;
    } else options[flag === "--session" ? "sessions" : "tasks"].push(value);
  }
  if (
    !options.help &&
    (options.command === "report"
      ? options.db === undefined
      : !options.sessions.length && !options.tasks.length)
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
    if (options.command === "report") {
      const { statSync } = await import("node:fs");
      if (!statSync(options.db).isFile()) throw new Error("database");
    }
    const { openLedger } = await import("./ledger.js");
    ledger = openLedger(options.db);
    if (options.command === "report") {
      console.log(JSON.stringify(ledger.runtimeReport({})));
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
      options.command === "report"
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
