// Background work that nothing on screen needs yet must not land while the
// viewer is moving around right after launch, when the main thread is already
// short on time. This runs a task once the remote has been idle for a while.
let lastInputAt = 0;
let listening = false;

function listen() {
  if (listening || typeof globalThis.addEventListener !== "function") return;
  listening = true;
  globalThis.addEventListener(
    "keydown",
    () => {
      lastInputAt = Date.now();
    },
    { capture: true, passive: true }
  );
}

/**
 * Runs `task` after `quietMs` without a key press, counting from the call, in
 * idle time where the runtime has it. Resolves with the task's result.
 */
export function whenInputQuiet(task, { quietMs = 5000 } = {}) {
  listen();
  lastInputAt = Math.max(lastInputAt, Date.now());
  return new Promise((resolve, reject) => {
    const check = () => {
      const wait = lastInputAt + quietMs - Date.now();
      if (wait > 0) {
        setTimeout(check, wait);
        return;
      }
      const run = () => {
        Promise.resolve().then(task).then(resolve, reject);
      };
      if (typeof globalThis.requestIdleCallback === "function") {
        globalThis.requestIdleCallback(run, { timeout: 2000 });
      } else {
        run();
      }
    };
    check();
  });
}
