import { spawnSync } from 'node:child_process';
import { which } from './tools.js';

export type SandboxMode = 'auto' | 'require' | 'off';
export interface SandboxInfo { available: boolean; kind: 'bwrap' | null; reason: string }

let cached: SandboxInfo | null = null;

/** OS sandbox availability. Linux: bubblewrap (read-only filesystem, scratch dir only writable, no network). */
export function sandboxInfo(): SandboxInfo {
  if (cached) return cached;
  if (process.platform !== 'linux') return (cached = { available: false, kind: null, reason: `no OS sandbox implemented for ${process.platform}` });
  const bw = which('bwrap');
  if (!bw) return (cached = { available: false, kind: null, reason: 'bubblewrap (bwrap) is not installed' });
  const r = spawnSync(bw, ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--unshare-net', '--die-with-parent', '--', 'true'], { timeout: 8000 });
  cached = r.status === 0
    ? { available: true, kind: 'bwrap', reason: 'bubblewrap available' }
    : { available: false, kind: null, reason: `bubblewrap is installed but cannot create a sandbox here (${(r.stderr?.toString() ?? '').trim().split('\n')[0] || 'unknown error'})` };
  return cached;
}

export interface SandboxPlan { file: string; args: string[]; sandboxed: boolean }

/**
 * Wrap a command so that: the whole filesystem is READ-ONLY, only `scratch` is writable,
 * there is no network, no access to other processes, and it dies with FThisUp.
 */
export function wrapInSandbox(file: string, args: string[], opts: { scratch: string; cwd: string; projectRoot: string }): SandboxPlan {
  const bw = which('bwrap')!;
  const full = [
    '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp',
    // the project stays visible (read-only) even if it lives under /tmp, then only the scratch dir is writable
    '--ro-bind', opts.projectRoot, opts.projectRoot,
    '--bind', opts.scratch, opts.scratch,
    '--chdir', opts.cwd,
    '--unshare-net', '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--die-with-parent', '--new-session',
    '--', file, ...args,
  ];
  return { file: bw, args: full, sandboxed: true };
}
