// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  createBuildScheduler,
  isBuildInput,
  tscBuildArgs,
  tsxWatchArgs,
} from '../../../../scripts/lib/dev-live.mjs';

function manualTimers() {
  let next: (() => void) | null = null;
  return {
    setTimer: (fn: () => void) => {
      next = fn;
      return 1;
    },
    clearTimer: () => {
      next = null;
    },
    fire: () => {
      const fn = next;
      next = null;
      fn?.();
    },
  };
}

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('dev live mode', () => {
  it('never lets tsx watch dist, and restarts on the build stamp', () => {
    const args = tsxWatchArgs('packages/ocpp/src/start.ts', '/tmp/stamp');
    expect(args[0]).toBe('watch');
    expect(args).toEqual(
      expect.arrayContaining(['--exclude', '**/dist/**', '--include', '/tmp/stamp']),
    );
    expect(args.at(-1)).toBe('packages/ocpp/src/start.ts');
    expect(args[args.indexOf('--exclude') + 1]).toBe('**/dist/**');
    expect(tscBuildArgs(['packages/lib'])).toEqual(['-b', '--preserveWatchOutput', 'packages/lib']);
  });

  it('runs one build for a burst of changes and stamps it once', async () => {
    const timers = manualTimers();
    let builds = 0;
    let stamps = 0;
    const scheduler = createBuildScheduler({
      build: () => {
        builds++;
        return Promise.resolve(true);
      },
      onBuilt: () => {
        stamps++;
      },
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    for (let i = 0; i < 50; i++) scheduler.changed();
    timers.fire();
    await settle();
    expect(builds).toBe(1);
    expect(stamps).toBe(1);
    expect(scheduler.busy()).toBe(false);
  });

  it('never runs two builds at once and builds again for a change during a build', async () => {
    const timers = manualTimers();
    let running = 0;
    let maxRunning = 0;
    let builds = 0;
    const releases: (() => void)[] = [];
    const scheduler = createBuildScheduler({
      build: () => {
        builds++;
        running++;
        maxRunning = Math.max(maxRunning, running);
        return new Promise<boolean>((resolve) => {
          releases.push(() => {
            running--;
            resolve(true);
          });
        });
      },
      onBuilt: () => undefined,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    scheduler.changed();
    timers.fire();
    await settle();
    scheduler.changed();
    scheduler.changed();
    releases.shift()?.();
    await settle();
    expect(builds).toBe(2);
    releases.shift()?.();
    await settle();
    expect(builds).toBe(2);
    expect(maxRunning).toBe(1);
  });

  it('keeps the service on the previous build when a build fails', async () => {
    const timers = manualTimers();
    let stamps = 0;
    const scheduler = createBuildScheduler({
      build: () => Promise.resolve(false),
      onBuilt: () => {
        stamps++;
      },
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    scheduler.changed();
    timers.fire();
    await settle();
    expect(stamps).toBe(0);
  });

  it('builds for source files only', () => {
    expect(isBuildInput('index.ts')).toBe(true);
    expect(isBuildInput('lib/audit.ts')).toBe(true);
    expect(isBuildInput('lib/__tests__/audit.test.ts')).toBe(false);
    expect(isBuildInput('audit.test.ts')).toBe(false);
    expect(isBuildInput('notes.md')).toBe(false);
    expect(isBuildInput('')).toBe(true);
  });

  it('ships the script in the backend dev images', () => {
    for (const pkg of ['api', 'worker', 'ocpp']) {
      const dockerfile = readFileSync(
        new URL(`../../../${pkg}/Dockerfile.dev`, import.meta.url),
        'utf8',
      );
      expect(dockerfile).toContain('COPY scripts/dev-live.mjs scripts/dev-live.mjs');
      expect(dockerfile).toContain('COPY scripts/lib/ scripts/lib/');
    }
  });
});
