// Types for dev-live.mjs, which plain node runs without a build step.

export function tsxWatchArgs(entry: string, stampPath: string): string[];
export function tscBuildArgs(packages: string[]): string[];
export function createBuildScheduler(options: {
  build: () => Promise<boolean>;
  onBuilt: () => void | Promise<void>;
  delayMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}): { changed(): void; busy(): boolean };
export function isBuildInput(relativePath: string): boolean;
