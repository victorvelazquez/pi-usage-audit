import { openLedger } from "../src/ledger.js";

// Each process opens and initializes the database itself, after a shared gate.
process.send("ready");
process.once("message", () => {
  try {
    const ledger = openLedger(process.argv[2]);
    ledger.importFiles({ sessions: process.argv.slice(3) });
    ledger.close();
    process.disconnect();
  } catch {
    process.exitCode = 1;
    process.disconnect();
  }
});
