const modes = new Set([5, 10, 30, "paused"]);

function validateMode(mode) {
  if (!modes.has(mode)) throw new Error("Invalid update mode");
}

// The callbacks own source admission and the complete import/report pipeline.
// This coordinator neither reads files nor grants permission to access them.
export function createUpdateCoordinator({
  importSources,
  refreshReport,
  mode = 10,
  now = Date.now,
  schedule = setTimeout,
  cancel = clearTimeout,
} = {}) {
  validateMode(mode);
  if (
    [importSources, refreshReport, now, schedule, cancel].some(
      (callback) => typeof callback !== "function",
    )
  )
    throw new Error("Invalid update callbacks");

  let started = false;
  let stopped = false;
  let active = null;
  let timer = null;
  let generation = 0;
  let status = "idle";
  let report = null;
  let lastCompletedAt = null;
  const state = () => ({ mode, status, report, lastCompletedAt });

  function clearTimer() {
    generation++;
    if (timer !== null) cancel(timer);
    timer = null;
  }

  function arm() {
    clearTimer();
    if (!started || stopped || mode === "paused" || active) return;
    const expected = generation;
    timer = schedule(() => {
      if (stopped || generation !== expected) return;
      timer = null;
      return run();
    }, mode * 60_000);
  }

  function assertOpen() {
    if (stopped) throw new Error("Coordinator stopped");
  }

  function run() {
    assertOpen();
    // Overlapping triggers share this cycle, never queue additional imports.
    if (active) return active;
    clearTimer();
    status = "updating";
    active = Promise.resolve()
      .then(async () => {
        try {
          await importSources();
          const candidate = await refreshReport();
          const completedAt = now();
          report = candidate;
          lastCompletedAt = completedAt;
          status = "ready";
        } catch {
          // A committed import is not proof of a successfully refreshed report.
          // Keep the previous report/time; never expose callback errors or paths.
          status = "failed";
        }
        return state();
      })
      .finally(() => {
        active = null;
        arm();
      });
    return active;
  }

  return {
    state,
    start() {
      assertOpen();
      if (started) return active ?? Promise.resolve(state());
      started = true;
      // Paused means no periodic work, not skipping the initial update.
      return run();
    },
    updateNow() {
      assertOpen();
      if (!started) throw new Error("Coordinator not started");
      return run();
    },
    setMode(next) {
      assertOpen();
      validateMode(next);
      const resume = mode === "paused" && next !== "paused";
      mode = next;
      clearTimer();
      if (started && resume) return run();
      arm();
      return Promise.resolve(state());
    },
    async stop() {
      stopped = true;
      clearTimer();
      // Let an admitted cycle finish; shutdown must wait before closing storage.
      if (active) await active;
      status = "stopped";
      return state();
    },
  };
}
