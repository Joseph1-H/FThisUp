import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { ROOT } from '../helpers.js';

// Real `npm install -g` from a git repository, with devDependencies omitted and no TypeScript on PATH.
// Needs the npm registry (it installs commander/playwright/zod/yaml), so it is opt-in: FTHISUP_TEST_INSTALL=1.
const enabled = process.env.FTHISUP_TEST_INSTALL === '1';

describe.skipIf(!enabled)('install from a git repository', () => {
  it('installs globally without devDependencies or a global TypeScript, and the CLI runs', () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(process.env.FTHISUP_TEST_TMP ?? os.tmpdir(), 'fthisup-install-')));
    const work = path.join(base, 'work'); fs.mkdirSync(work);
    // the repository exactly as it would be committed: every tracked or not-ignored file in the working tree
    const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
    for (const f of files) { if (!fs.existsSync(path.join(ROOT, f))) continue; fs.mkdirSync(path.dirname(path.join(work, f)), { recursive: true }); fs.copyFileSync(path.join(ROOT, f), path.join(work, f)); }
    const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: work, encoding: 'utf8' });
    git('init', '-q', '-b', 'main'); git('add', '-A'); git('commit', '-qm', 'snapshot');
    const prefix = path.join(base, 'prefix');
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production', NPM_CONFIG_OMIT: 'dev', NPM_CONFIG_CACHE: path.join(base, 'cache'), TMPDIR: base };
    const noTsc = (env.PATH ?? '').split(path.delimiter).filter((d) => !fs.existsSync(path.join(d, 'tsc'))).join(path.delimiter);
    env.PATH = noTsc;
    const r = spawnSync('npm', ['install', '-g', '--prefix', prefix, `git+file://${work}`], { env, encoding: 'utf8', timeout: 280_000 });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    const bin = path.join(prefix, 'bin', 'fthisup');
    const v = spawnSync(bin, ['--version'], { env, encoding: 'utf8' });
    expect(v.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    const pkgDir = path.join(prefix, 'lib', 'node_modules', 'fthisup');
    expect(fs.existsSync(path.join(pkgDir, 'skills', 'fthisup', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(pkgDir, 'node_modules', 'typescript'))).toBe(false);
    const proj = path.join(base, 'proj'); fs.mkdirSync(proj); fs.writeFileSync(path.join(proj, 'package.json'), '{"name":"p"}');
    const scan = spawnSync(bin, ['scan'], { cwd: proj, env, encoding: 'utf8' });
    expect(scan.status).toBe(0);
    expect(spawnSync(bin, ['install-skill', '--dir', path.join(base, 'skills')], { env, encoding: 'utf8' }).status).toBe(0);
    expect(fs.existsSync(path.join(base, 'skills', 'fthisup', 'SKILL.md'))).toBe(true);
    fs.rmSync(base, { recursive: true, force: true });
  }, 300_000);
});
