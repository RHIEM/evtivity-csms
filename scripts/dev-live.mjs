#!/usr/bin/env node
// Runs a backend service in live mode (dev containers with mounted sources):
//
//   node scripts/dev-live.mjs <entry> [<dist package dir>...]
//   node scripts/dev-live.mjs packages/ocpp/src/start.ts packages/lib packages/database
//
// Builds the dist packages once, then starts `tsx watch` on the entry with
// dist excluded. Source changes in a dist package rebuild it and restart the
// service once the build succeeded (scripts/lib/dev-live.mjs says why).
import { spawn } from 'node:child_process';
import { watch, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBuildScheduler, isBuildInput, tscBuildArgs, tsxWatchArgs } from './lib/dev-live.mjs';

const [entry, ...distPackages] = process.argv.slice(2);
if (!entry) {
  console.error('usage: node scripts/dev-live.mjs <entry> [<dist package dir>...]');
  process.exit(2);
}

const stampDir = join(tmpdir(), 'evtivity-dev-live');
mkdirSync(stampDir, { recursive: true });
const stampPath = join(stampDir, 'dist-built');

function touchStamp() {
  writeFileSync(stampPath, `${new Date().toISOString()}\n`);
}

function runTsc() {
  return new Promise((resolve) => {
    const child = spawn('npx', ['tsc', ...tscBuildArgs(distPackages)], { stdio: 'inherit' });
    child.on('error', (err) => {
      console.error(`[dev-live] tsc did not start: ${err.message}`);
      resolve(false);
    });
    child.on('exit', (code) => {
      if (code !== 0)
        console.error(`[dev-live] tsc -b exited ${code}; the service keeps the previous build`);
      resolve(code === 0);
    });
  });
}

if (distPackages.length > 0) {
  if (!(await runTsc())) process.exit(1);
}
touchStamp();

if (distPackages.length > 0) {
  const scheduler = createBuildScheduler({
    build: runTsc,
    onBuilt: () => {
      console.log('[dev-live] dist rebuilt, restarting the service');
      touchStamp();
    },
  });
  for (const pkg of distPackages) {
    watch(join(pkg, 'src'), { recursive: true }, (_event, file) => {
      if (isBuildInput(file ? String(file) : '')) scheduler.changed();
    });
  }
}

const service = spawn('npx', ['tsx', ...tsxWatchArgs(entry, stampPath)], { stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => service.kill(signal));
}
service.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
