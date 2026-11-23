import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runProcess } from '../../exec/run.js';
import { generateDartTest, type CodegenContext } from './codegen.js';
import type { FlutterScenario } from './schema.js';

/** Isolated workspace + execution of generated Flutter widget tests. The user's project is only ever READ. */

const COPY_EXCLUDE = new Set(['.git', 'build', '.dart_tool', 'android', 'ios', 'macos', 'linux', 'windows', 'web', 'node_modules', '.fthisup-tmp', 'fthisup-results', 'fthisup-scenarios', '.idea', '.vscode', 'test', 'integration_test', 'coverage']);
const live = new Set<string>();
let hooked = false;
function hookCleanup() {
  if (hooked) return;
  hooked = true;
  const sweep = () => { for (const d of live) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } live.clear(); };
  process.on('exit', sweep);
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { sweep(); process.exit(130); });
}

export interface Workspace { dir: string; root: string; copied: string[]; generatedDir: string }

export function treeHash(dir: string, include: (rel: string) => boolean): string {
  const h = crypto.createHash('sha1');
  const rec = (d: string, rel: string) => {
    let ents: fs.Dirent[] = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); } catch { return; }
    for (const e of ents) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!/^(\.dart_tool|build|\.git|node_modules|\.fthisup-tmp|fthisup-results)$/.test(e.name)) rec(path.join(d, e.name), r); }
      else if (include(r)) { try { h.update(r); h.update(fs.readFileSync(path.join(d, e.name))); } catch { /* unreadable */ } }
    }
  };
  rec(dir, '');
  return h.digest('hex');
}

export function createWorkspace(compDir: string): Workspace {
  hookCleanup();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fthisup-ws-'));
  live.add(dir);
  const copied: string[] = [];
  const rec = (src: string, dst: string, rel: string) => {
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      if (!rel && COPY_EXCLUDE.has(e.name)) continue;
      if (e.isSymbolicLink()) continue; // never follow links out of the project
      const s = path.join(src, e.name), d = path.join(dst, e.name);
      if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); rec(s, d, `${rel}${e.name}/`); }
      else { fs.copyFileSync(s, d); copied.push(`${rel}${e.name}`); }
    }
  };
  rec(compDir, dir, '');
  const generatedDir = path.join(dir, 'test', 'fthisup_generated');
  fs.mkdirSync(generatedDir, { recursive: true });
  return { dir, root: dir, copied, generatedDir };
}

export function destroyWorkspace(ws: Workspace): boolean {
  try { fs.rmSync(ws.dir, { recursive: true, force: true }); } catch { /* ignore */ }
  live.delete(ws.dir);
  return !fs.existsSync(ws.dir);
}

export interface RawPayload { status: 'ok' | 'failed' | 'setup' | 'baseline'; observed: Array<{ where: string; type: string; message: string; stack: string[] }>; failed: Array<{ where: string; message: string }>; network: string[]; extra?: unknown }
export interface RawRun { payload?: RawPayload; frameworkErrors: string[]; loadError?: string; ran: boolean }

/** Parse `flutter test --reporter json` output into a per-scenario view. */
export function parseGenerated(stdout: string, ids: string[]): Map<string, RawRun> {
  const out = new Map<string, RawRun>(ids.map((i) => [i, { frameworkErrors: [], ran: false }]));
  const byTest = new Map<number, string>();
  const loading = new Map<number, string>();
  for (const line of stdout.split('\n')) {
    if (!line.startsWith('{')) continue;
    let e: Record<string, any>;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type === 'testStart') {
      const name = String(e.test?.name ?? '');
      const m = /^FTHISUP::(.+)$/.exec(name);
      if (m && out.has(m[1]!)) { byTest.set(e.test.id, m[1]!); out.get(m[1]!)!.ran = true; }
      const l = /^loading .*fthisup_generated[\\/](.+)_test\.dart$/.exec(name);
      if (l) loading.set(e.test.id, l[1]!);
    } else if (e.type === 'print' && typeof e.message === 'string' && e.message.startsWith('FTHISUP_RESULT ')) {
      const id = byTest.get(e.testID);
      if (id) { try { out.get(id)!.payload = JSON.parse(e.message.slice('FTHISUP_RESULT '.length)) as RawPayload; } catch { /* malformed */ } }
    } else if (e.type === 'error') {
      const id = byTest.get(e.testID);
      const lid = loading.get(e.testID);
      const text = String(e.error ?? '').split('\n').slice(0, 6).join(' | ');
      if (id) out.get(id)!.frameworkErrors.push(text);
      else if (lid && out.has(lid)) out.get(lid)!.loadError = text;
    }
  }
  return out;
}

export interface RunBatch { stdout: string; stderr: string; exitCode: number | null; timedOut: boolean; spawnError?: string; durationMs: number; command: string }

export async function flutterPubGet(ws: Workspace, timeoutMs: number): Promise<RunBatch> {
  const r = await runProcess({ file: 'flutter', args: ['pub', 'get', '--offline'], cwd: ws.dir, projectRoot: ws.root, timeoutMs, limits: false });
  return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, timedOut: r.timedOut, spawnError: r.spawnError, durationMs: r.durationMs, command: r.command };
}

export async function runGeneratedTests(ws: Workspace, files: string[], perTestSeconds: number, totalTimeoutMs: number): Promise<RunBatch> {
  const r = await runProcess({
    file: 'flutter', args: ['test', '--reporter', 'json', '--no-pub', `--timeout=${perTestSeconds}s`, ...files.map((f) => path.posix.join('test/fthisup_generated', f))],
    cwd: ws.dir, projectRoot: ws.root, timeoutMs: totalTimeoutMs, limits: false, maxOutputBytes: 4 * 1024 * 1024,
  });
  return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, timedOut: r.timedOut, spawnError: r.spawnError, durationMs: r.durationMs, command: r.command };
}

export function writeScenarioTests(ws: Workspace, scenarios: FlutterScenario[], cg: CodegenContext): Array<{ id: string; file: string; source: string }> {
  return scenarios.map((sc) => {
    const file = `${sc.id}_test.dart`;
    const source = generateDartTest(sc, cg);
    fs.writeFileSync(path.join(ws.generatedDir, file), source, 'utf8');
    return { id: sc.id, file, source };
  });
}
