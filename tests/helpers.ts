import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CLI = path.join(ROOT, 'dist', 'cli', 'index.js');

export interface Fixture { url: string; port: number; stop: () => void; stats: () => Promise<{ deleteCalls: number; posts: number; notes: number }> }

export async function startFixture(name: 'buggy-app' | 'clean-app' | 'auth-app', env: NodeJS.ProcessEnv = {}, cwd?: string): Promise<Fixture> {
  const child: ChildProcess = spawn(process.execPath, [path.join(ROOT, 'tests', 'fixtures', name, 'server.mjs')], { cwd, env: { ...process.env, PORT: '0', ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise<number>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('fixture did not start')), 10000);
    child.stdout!.on('data', (d) => { const m = /LISTENING (\d+)/.exec(String(d)); if (m) { clearTimeout(t); resolve(Number(m[1])); } });
    child.on('exit', () => reject(new Error('fixture exited')));
  });
  const url = `http://127.0.0.1:${port}`;
  return { url, port, stop: () => child.kill(), stats: async () => (await fetch(`${url}/__stats`)).json() as Promise<{ deleteCalls: number; posts: number; notes: number }> };
}

/** A throwaway PROJECT (has a package.json) so FThisUp accepts it as a project root. */
export function tmpDir(prefix = 'fthisup-'): string {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  fs.writeFileSync(path.join(d, 'package.json'), '{"name":"tmp-project"}');
  return d;
}
/** A directory that is NOT a project (no markers). */
export function bareDir(prefix = 'fthisup-bare-'): string { return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix))); }

export function runCli(args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: opts.cwd ?? ROOT, env: { ...process.env, NO_COLOR: '1', ...opts.env } });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const t = setTimeout(() => child.kill(), opts.timeoutMs ?? 180000);
    child.on('close', (code) => { clearTimeout(t); resolve({ code, stdout, stderr }); });
  });
}

/** Copy a fixture project into a fresh throwaway project directory. */
export function copyFixture(name: string, extra: Record<string, string> = {}): string {
  const proj = tmpDir();
  fs.cpSync(path.join(ROOT, 'tests', 'fixtures', 'projects', name), proj, { recursive: true });
  for (const [f, content] of Object.entries(extra)) { fs.mkdirSync(path.dirname(path.join(proj, f)), { recursive: true }); fs.writeFileSync(path.join(proj, f), content); }
  return proj;
}

/** Start `<dir>/server.mjs` with its cwd INSIDE the project (so the project-scope ownership check passes). */
export async function startServerIn(dir: string, env: NodeJS.ProcessEnv = {}): Promise<Fixture> {
  const child: ChildProcess = spawn(process.execPath, [path.join(dir, 'server.mjs')], { cwd: dir, env: { ...process.env, PORT: '0', ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise<number>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 10000);
    child.stdout!.on('data', (d) => { const m = /LISTENING (\d+)/.exec(String(d)); if (m) { clearTimeout(t); resolve(Number(m[1])); } });
    child.on('exit', () => reject(new Error('server exited')));
  });
  const url = `http://127.0.0.1:${port}`;
  return { url, port, stop: () => child.kill(), stats: async () => (await fetch(`${url}/__stats`)).json() as Promise<{ deleteCalls: number; posts: number; notes: number }> };
}

export function readJson<T = any>(...p: string[]): T { return JSON.parse(fs.readFileSync(path.join(...p), 'utf8')) as T; }
