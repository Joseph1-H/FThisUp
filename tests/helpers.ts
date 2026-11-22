import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CLI = path.join(ROOT, 'dist', 'cli', 'index.js');

export interface Fixture { url: string; port: number; stop: () => void; stats: () => Promise<{ deleteCalls: number; posts: number; notes: number }> }

export async function startFixture(name: 'buggy-app' | 'clean-app' | 'auth-app', env: NodeJS.ProcessEnv = {}): Promise<Fixture> {
  const child: ChildProcess = spawn(process.execPath, [path.join(ROOT, 'tests', 'fixtures', name, 'server.mjs')], { env: { ...process.env, PORT: '0', ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise<number>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('fixture did not start')), 10000);
    child.stdout!.on('data', (d) => { const m = /LISTENING (\d+)/.exec(String(d)); if (m) { clearTimeout(t); resolve(Number(m[1])); } });
    child.on('exit', () => reject(new Error('fixture exited')));
  });
  const url = `http://127.0.0.1:${port}`;
  return { url, port, stop: () => child.kill(), stats: async () => (await fetch(`${url}/__stats`)).json() as Promise<{ deleteCalls: number; posts: number; notes: number }> };
}

export function tmpDir(prefix = 'fthisup-'): string { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

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
