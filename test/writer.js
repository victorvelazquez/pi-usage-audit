import { openLedger } from "../src/ledger.js";

// Synchronous test writer commits between instrumented reader queries.
if (process.argv[2] === "--commit") {
  const ledger = openLedger(process.argv[3]);
  try {
    ledger.importFiles({
      sessions: [process.argv[4]],
      tasks: process.argv[5] ? [process.argv[5]] : [],
    });
  } finally {
    ledger.close();
  }
} else {
  // Each process opens and initializes the database itself, after a shared gate.
  process.send("ready");
  process.once("message", () => {
    let ledger;
    try {
      ledger = openLedger(process.argv[2]);
      ledger.importFiles({ sessions: process.argv.slice(3) });
    } catch {
      process.exitCode = 1;
    } finally {
      if (ledger) ledger.close();
      process.disconnect();
    }
  });
}
