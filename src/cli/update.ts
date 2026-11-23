import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO_URL = 'https://github.com/Joseph1-H/FThisUp';

export type UpdateState = 'up-to-date' | 'updated' | 'available' | 'skipped' | 'error';
export interface UpdateOutcome { dir: string; state: UpdateState; from?: string; to?: string; message: string }

function git(dir: string, args: string[], timeout = 120_000) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() || (r.error?.message ?? '') };
}

function pkgVersion(json: string): string | undefined {
  try { return (JSON.parse(json) as { version?: string }).version; } catch { return undefined; }
}

/** Is `dir` a git checkout of FThisUp? (we never touch any other repository) */
export function isFThisUpCheckout(dir: string): boolean {
  if (!fs.existsSync(path.join(dir, '.git'))) return false;
  const url = git(dir, ['remote', 'get-url', 'origin']);
  if (!url.ok || !/fthisup/i.test(url.out)) return false;
  try { return (JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { name?: string }).name === 'fthisup'; } catch { return false; }
}

/** Update one git checkout of FThisUp to the newest commit on its tracked branch. */
export function updateCheckout(dir: string, opts: { checkOnly?: boolean } = {}): UpdateOutcome {
  const here = pkgVersion(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const head = git(dir, ['rev-parse', 'HEAD']);
  if (!head.ok) return { dir, state: 'error', message: `cannot read git state: ${head.err}` };
  const branch = git(dir, ['symbolic-ref', '--short', 'HEAD']);
  if (!branch.ok) return { dir, state: 'skipped', from: here, message: 'detached HEAD, not updating automatically' };
  const shallow = git(dir, ['rev-parse', '--is-shallow-repository']).out === 'true';
  const fetched = git(dir, ['fetch', '--quiet', ...(shallow ? ['--depth', '1'] : []), 'origin', branch.out]);
  if (!fetched.ok) return { dir, state: 'error', from: here, message: `could not reach GitHub: ${fetched.err.split('\n')[0] || 'fetch failed'}` };
  const remote = git(dir, ['rev-parse', 'FETCH_HEAD']);
  if (!remote.ok) return { dir, state: 'error', from: here, message: remote.err };
  if (remote.out === head.out) return { dir, state: 'up-to-date', from: here, to: here, message: `already on the latest version (${here})` };
  // Remote differs. Only fast-forward: if our HEAD is not an ancestor of the remote, we are ahead/diverged.
  const anc = git(dir, ['merge-base', '--is-ancestor', head.out, remote.out]);
  if (!anc.ok && !shallow) return { dir, state: 'skipped', from: here, message: 'this copy has local commits that are not on GitHub, so it was left alone' };
  const there0 = pkgVersion(git(dir, ['show', 'FETCH_HEAD:package.json']).out) ?? here;
  // Same version number but new commits: show the commit ids so the message is not "0.2.0 → 0.2.0".
  const label = (v: string | undefined, sha: string) => (there0 === here ? `${v} (${sha.slice(0, 7)})` : `${v}`);
  const fromL = label(here, head.out), there = there0 === here ? label(there0, remote.out) : there0;
  if (opts.checkOnly) return { dir, state: 'available', from: here, to: there, message: `update available: ${fromL} → ${there}` };
  // dist/ is generated and committed (prebuilt for GitHub installs): local rebuilds of it are never "your changes".
  const distTracked = git(dir, ['cat-file', '-e', 'FETCH_HEAD:dist/cli/index.js']).ok; // the new version ships dist/ prebuilt
  if (git(dir, ['ls-files', '--error-unmatch', 'dist/cli/index.js']).ok) git(dir, ['checkout', '--quiet', '--', 'dist']);
  if (git(dir, ['status', '--porcelain', '--untracked-files=no']).out) return { dir, state: 'skipped', from: here, message: 'you have uncommitted changes here, so it was left alone' };
  // A depth-1 clone (the documented install) has no shared history to merge: it is a read-only mirror, so move it to the new commit.
  const merged = shallow ? git(dir, ['reset', '--hard', '--quiet', 'FETCH_HEAD']) : git(dir, ['merge', '--ff-only', '--quiet', 'FETCH_HEAD']);
  if (!merged.ok) return { dir, state: 'error', from: here, message: `could not fast-forward: ${merged.err.split('\n')[0]}` };
  const notes: string[] = [];
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const sh = process.platform === 'win32';
  if (fs.existsSync(path.join(dir, 'node_modules'))) {
    const i = spawnSync(npm, ['install', '--no-audit', '--no-fund', '--silent'], { cwd: dir, encoding: 'utf8', timeout: 600_000, shell: sh });
    if (i.status !== 0) return { dir, state: 'error', from: here, to: there, message: `updated the files but "npm install" failed: ${(i.stderr || '').trim().split('\n')[0]}` };
    notes.push('dependencies refreshed');
  }
  if (!distTracked && fs.existsSync(path.join(dir, 'dist'))) {
    const b = spawnSync(npm, ['run', 'compile', '--silent'], { cwd: dir, encoding: 'utf8', timeout: 600_000, shell: sh });
    if (b.status !== 0) return { dir, state: 'error', from: here, to: there, message: `updated the files but "npm run compile" failed: ${(b.stderr || b.stdout || '').trim().split('\n')[0]}` };
    notes.push('rebuilt');
  }
  return { dir, state: 'updated', from: here, to: there, message: `updated ${fromL} → ${there}${notes.length ? ` (${notes.join(', ')})` : ''}` };
}

/** Where FThisUp copies live: the running install plus any skill clones the user has. Never any other directory. */
export function findInstalls(opts: { selfRoot: string; cwd: string; home?: string }): { checkouts: string[]; copies: string[] } {
  const home = opts.home ?? os.homedir();
  const real = (p: string) => { try { return fs.realpathSync(p); } catch { return p; } };
  const seen = new Set<string>();
  const checkouts: string[] = []; const copies: string[] = [];
  const candidates = [opts.selfRoot];
  for (const base of [home, opts.cwd]) for (const rel of ['.claude/skills', '.agents/skills', '.cursor/skills']) candidates.push(path.join(base, rel, 'fthisup'));
  for (const c of candidates) {
    if (!fs.existsSync(path.join(c, 'SKILL.md')) && c !== opts.selfRoot) continue;
    const r = real(c);
    if (seen.has(r)) continue;
    seen.add(r);
    if (isFThisUpCheckout(r)) checkouts.push(r);
    else if (c !== opts.selfRoot) copies.push(r);
  }
  return { checkouts, copies };
}

export function selfRoot(): string { return path.resolve(fileURLToPath(new URL('../../', import.meta.url))); }

export const INSTALL_SPEC = 'git+https://github.com/Joseph1-H/FThisUp.git';

/** Is this a copy that `npm install -g <git url>` put in a global node_modules (and not a throwaway npx cache)? */
export function isGlobalNpmInstall(root: string): boolean {
  const p = root.split(path.sep);
  return p[p.length - 2] === 'node_modules' && p[p.length - 1] === 'fthisup' && !p.includes('_npx');
}

function newer(a: string, b: string): boolean {
  const n = (v: string) => v.split('-')[0]!.split('.').map((x) => parseInt(x, 10) || 0);
  const [x, y] = [n(a), n(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

/** Update an `npm install -g` copy: compare with the version on GitHub, then reinstall from GitHub. */
export async function updateGlobalInstall(root: string, opts: { checkOnly?: boolean } = {}): Promise<UpdateOutcome> {
  const here = pkgVersion(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  let there: string | undefined;
  try {
    const res = await fetch('https://raw.githubusercontent.com/Joseph1-H/FThisUp/main/package.json', { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    there = pkgVersion(await res.text());
  } catch (e) { return { dir: root, state: 'error', from: here, message: `could not reach GitHub: ${(e as Error).message}` }; }
  if (!there || !here) return { dir: root, state: 'error', from: here, message: 'could not read the version number' };
  if (!newer(there, here)) return { dir: root, state: 'up-to-date', from: here, to: here, message: `already on the latest version (${here})` };
  if (opts.checkOnly) return { dir: root, state: 'available', from: here, to: there, message: `update available: ${here} → ${there}` };
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['install', '-g', INSTALL_SPEC], { encoding: 'utf8', timeout: 600_000, shell: process.platform === 'win32' });
  if (r.status !== 0) return { dir: root, state: 'error', from: here, to: there, message: `"npm install -g ${INSTALL_SPEC}" failed: ${(r.stderr || '').trim().split('\n').find((l) => /error/i.test(l)) ?? 'see npm output'}` };
  return { dir: root, state: 'updated', from: here, to: there, message: `updated ${here} → ${there} (reinstalled from GitHub)` };
}
