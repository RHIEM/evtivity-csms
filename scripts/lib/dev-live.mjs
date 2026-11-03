// Live mode for a backend service in a dev container (mounted sources).
//
// Packages imported through their dist output (lib, database, payments, ocpp,
// ...) need a TypeScript build before a service sees a source change. Running
// `tsc -b --watch` next to `tsx watch` made tsx restart the service on every
// file tsc wrote under dist, many times per build, and kill the service while
// it was still shutting down: the OCPP server kept restarting. Here tsx never
// watches dist. One watcher rebuilds the dist packages after their sources
// change and touches a stamp file once the build succeeded; tsx watches that
// stamp, so a build restarts the service once.

/** Arguments for `tsx watch`: dist excluded, the build stamp included. */
export function tsxWatchArgs(entry, stampPath) {
  return [
    'watch',
    '--clear-screen=false',
    '--exclude',
    '**/dist/**',
    '--include',
    stampPath,
    entry,
  ];
}

/** Arguments for one `tsc -b` of the dist packages. */
export function tscBuildArgs(packages) {
  return ['-b', '--preserveWatchOutput', ...packages];
}

/**
 * Debounced, never concurrent builds. `build` returns a promise of true on
 * success; `onBuilt` runs after each successful build. A change during a build
 * runs one more build after it.
 */
export function createBuildScheduler({
  build,
  onBuilt,
  delayMs = 400,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let timer = null;
  let running = false;
  let pending = false;

  async function run() {
    timer = null;
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      do {
        pending = false;
        const ok = await build();
        if (ok) await onBuilt();
      } while (pending);
    } finally {
      running = false;
    }
  }

  return {
    changed() {
      if (running) {
        pending = true;
        return;
      }
      if (timer !== null) clearTimer(timer);
      timer = setTimer(() => {
        void run();
      }, delayMs);
    },
    /** Test hook: whether a build is running or scheduled. */
    busy() {
      return running || timer !== null;
    },
  };
}

/** Whether a changed path (relative to a watched src dir) should trigger a build. */
export function isBuildInput(relativePath) {
  if (!relativePath) return true;
  const path = relativePath.split('\\').join('/');
  if (path.split('/').some((part) => part === '__tests__' || part === 'node_modules')) return false;
  return /\.(ts|tsx|mts|cts|json)$/.test(path) && !/\.test\.tsx?$/.test(path);
}
