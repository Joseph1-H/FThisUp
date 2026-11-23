import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { isInside } from '../utils/project-root.js';
import { sandboxInfo, wrapInSandbox, type SandboxMode } from './sandbox.js';
import { which } from './tools.js';

/** Executables FThisUp itself may launch (by basename). Project-local binaries are also allowed (see assertAllowed). */
const ALLOWED = new Set([
  'node', 'npm', 'npx', 'pnpm', 'yarn', 'python', 'python3', 'py', 'pytest',
  'cargo', 'rustc', 'go', 'flutter', 'dart', 'java', 'mvn', 'gradle', 'ctest', 'cmake', 'make', 'ninja', 'swift', 'xcodebuild',
  'godot', 'godot4', 'xvfb-run', 'dotnet', 'ruby', 'php', 'deno', 'bun',
]);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'cmd', 'cmd.exe', 'powershell', 'pwsh', 'powershell.exe']);

export class ExecBlockedError extends Error {}

const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|CREDENTIAL|COOKIE|SESSION|AUTH)/i;
const SECRET_PREFIX = /^(ANTHROPIC_|OPENAI_|AWS_|AZURE_|GCP_|GOOGLE_|GITHUB_|GH_|NPM_|NODE_AUTH|SSH_|GPG_|SLACK_|STRIPE_|DATABASE_URL|FTHISUP_TEST_|FTHISUP_API_)/i;

/** Child processes never inherit secrets, even if the user's shell has them. */
export function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (SECRET_PREFIX.test(k) || SECRET_NAME.test(k)) continue;
    out[k] = v;
  }
  out.CI = '1';
  out.NO_COLOR = '1';
  out.FORCE_COLOR = '0';
  out.FTHISUP = '1';
  return { ...out, ...extra };
}

/** Allowed = a known tool on the allowlist, or a binary located inside the project. Shells are never allowed. */
export function assertAllowed(file: string, projectRoot: string): void {
  const base = path.basename(file).replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
  if (SHELLS.has(base) || SHELLS.has(path.basename(file).toLowerCase())) throw new ExecBlockedError(`"${file}" is a shell; FThisUp never runs shell commands.`);
  if (ALLOWED.has(base)) return;
  const abs = path.isAbsolute(file) || file.includes('/') || file.includes('\\') ? path.resolve(projectRoot, file) : null;
  if (abs && isInside(projectRoot, abs)) return;
  throw new ExecBlockedError(`"${file}" is not an allow-listed tool and is not inside the project (${projectRoot}).`);
}

export interface RunSpec {
  file: string;
  args: string[];
  cwd: string;
  projectRoot: string;
  timeoutMs: number;
  stdin?: string | Buffer | null; // null/undefined => EOF immediately
  env?: Record<string, string>;
  maxOutputBytes?: number;
  /** send a signal after N ms (tests graceful shutdown) */
  signalAfterMs?: { ms: number; signal: NodeJS.Signals };
  sandbox?: SandboxMode;
  /** writable scratch dir when sandboxed (created if missing) */
  scratch?: string;
  /** apply prlimit CPU/file-size limits where available */
  limits?: boolean;
}

export interface RunOutcome {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
  spawnError?: string;
  sandboxed: boolean;
  command: string;
}

const MAX_OUT = 256 * 1024;

export function newScratch(root: string): string {
  const base = path.join(root, '.fthisup-tmp');
  fs.mkdirSync(base, { recursive: true });
  try { fs.writeFileSync(path.join(base, '.gitignore'), '*\n'); } catch { /* ignore */ }
  return fs.mkdtempSync(path.join(base, 'run-'));
}

export function cleanupScratch(dir: string) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

export function killTree(pid: number, signal: NodeJS.Signals) {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-pid, signal);
  } catch { /* gone */ }
}

export function runProcess(spec: RunSpec): Promise<RunOutcome> {
  return new Promise((resolve) => {
    const started = Date.now();
    const display = [spec.file, ...spec.args].map((a) => (/[\s"'$`]/.test(a) ? JSON.stringify(a.length > 120 ? `${a.slice(0, 120)}…` : a) : a)).join(' ');
    try { assertAllowed(spec.file, spec.projectRoot); } catch (e) {
      return resolve({ exitCode: null, signal: null, stdout: '', stderr: '', timedOut: false, truncated: false, durationMs: 0, spawnError: (e as Error).message, sandboxed: false, command: display });
    }
    if (!isInside(spec.projectRoot, spec.cwd)) {
      return resolve({ exitCode: null, signal: null, stdout: '', stderr: '', timedOut: false, truncated: false, durationMs: 0, spawnError: `working directory ${spec.cwd} is outside the project`, sandboxed: false, command: display });
    }
    let file = which(spec.file) ?? path.resolve(spec.cwd, spec.file);
    let args = spec.args;
    let sandboxed = false;
    const mode = spec.sandbox ?? 'off';
    if (mode !== 'off') {
      const info = sandboxInfo();
      if (info.available && spec.scratch) {
        const w = wrapInSandbox(file, args, { scratch: spec.scratch, cwd: spec.cwd });
        file = w.file; args = w.args; sandboxed = true;
      } else if (mode === 'require') {
        return resolve({ exitCode: null, signal: null, stdout: '', stderr: '', timedOut: false, truncated: false, durationMs: 0, spawnError: `sandbox required but unavailable: ${info.reason}`, sandboxed: false, command: display });
      }
    }
    if (spec.limits && process.platform === 'linux' && which('prlimit')) {
      args = [`--cpu=${Math.max(5, Math.ceil(spec.timeoutMs / 1000) + 5)}`, '--fsize=104857600', '--nofile=1024', '--', file, ...args];
      file = which('prlimit')!;
    }
    let child;
    try {
      child = spawn(file, args, { cwd: spec.cwd, env: cleanEnv({ ...(spec.scratch ? { HOME: spec.scratch } : {}), ...spec.env }), stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
    } catch (e) {
      return resolve({ exitCode: null, signal: null, stdout: '', stderr: '', timedOut: false, truncated: false, durationMs: Date.now() - started, spawnError: (e as Error).message, sandboxed, command: display });
    }
    const cap = spec.maxOutputBytes ?? MAX_OUT;
    let out = '', err = '', truncated = false, timedOut = false, done = false, spawnError: string | undefined;
    const take = (cur: string, d: Buffer) => { if (cur.length >= cap) { truncated = true; return cur; } const s = cur + d.toString('utf8'); if (s.length > cap) { truncated = true; return s.slice(0, cap); } return s; };
    child.stdout.on('data', (d: Buffer) => { out = take(out, d); });
    child.stderr.on('data', (d: Buffer) => { err = take(err, d); });
    child.stdin.on('error', () => { /* child closed stdin early (EPIPE): fine */ });
    try { child.stdin.end(spec.stdin ?? undefined); } catch { /* ignore */ }
    child.on('error', (e) => { spawnError = e.message; });
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) { killTree(child.pid, 'SIGTERM'); setTimeout(() => child.pid && killTree(child.pid!, 'SIGKILL'), 700).unref(); }
    }, spec.timeoutMs);
    let sigTimer: NodeJS.Timeout | undefined;
    if (spec.signalAfterMs) sigTimer = setTimeout(() => { if (child.pid) killTree(child.pid, spec.signalAfterMs!.signal); }, spec.signalAfterMs.ms);
    child.on('close', (code, signal) => {
      if (done) return;
      done = true;
      clearTimeout(timer); if (sigTimer) clearTimeout(sigTimer);
      if (child.pid) killTree(child.pid, 'SIGKILL'); // reap stragglers in the process group
      resolve({ exitCode: code, signal, stdout: out, stderr: err, timedOut, truncated, durationMs: Date.now() - started, spawnError, sandboxed, command: display });
    });
  });
}
