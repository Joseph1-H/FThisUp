import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { bareDir } from '../helpers.js';
import { updateCheckout, isFThisUpCheckout, findInstalls } from '../../src/cli/update.js';

const g = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const setPkg = (d: string, version: string) => fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'fthisup', version }));

function makeOrigin() {
  const base = bareDir('fthisup-upd-');
  const work = path.join(base, 'work'); fs.mkdirSync(work);
  g(work, 'init', '-q', '-b', 'main'); setPkg(work, '1.0.0'); fs.writeFileSync(path.join(work, 'SKILL.md'), 'x');
  g(work, 'add', '.'); g(work, 'commit', '-qm', 'v1');
  const origin = path.join(base, 'fthisup-origin.git');
  g(base, 'clone', '-q', '--bare', work, origin);
  g(work, 'remote', 'add', 'origin', origin);
  const release = (v: string) => { setPkg(work, v); g(work, 'commit', '-qam', `v${v}`); g(work, 'push', '-q', 'origin', 'main'); };
  return { base, origin, release };
}

describe('fthisup update', () => {
  it('says so when there is no new version, and changes nothing', () => {
    const { base, origin } = makeOrigin();
    const clone = path.join(base, 'c'); g(base, 'clone', '-q', origin, clone);
    const before = g(clone, 'rev-parse', 'HEAD');
    const r = updateCheckout(clone);
    expect(r.state).toBe('up-to-date');
    expect(r.message).toMatch(/latest version \(1\.0\.0\)/);
    expect(g(clone, 'rev-parse', 'HEAD')).toBe(before);
  });

  it('--check reports a newer version without touching the files', () => {
    const { base, origin, release } = makeOrigin();
    const clone = path.join(base, 'c'); g(base, 'clone', '-q', origin, clone);
    release('1.1.0');
    const r = updateCheckout(clone, { checkOnly: true });
    expect(r).toMatchObject({ state: 'available', from: '1.0.0', to: '1.1.0' });
    expect(JSON.parse(fs.readFileSync(path.join(clone, 'package.json'), 'utf8')).version).toBe('1.0.0');
  });

  it('fast-forwards a full clone and a depth-1 clone to the new version', () => {
    const { base, origin, release } = makeOrigin();
    const full = path.join(base, 'full'); g(base, 'clone', '-q', origin, full);
    const shallow = path.join(base, 'shallow'); g(base, 'clone', '-q', '--depth', '1', `file://${origin}`, shallow);
    release('1.2.0');
    for (const d of [full, shallow]) {
      expect(updateCheckout(d)).toMatchObject({ state: 'updated', from: '1.0.0', to: '1.2.0' });
      expect(JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')).version).toBe('1.2.0');
      expect(updateCheckout(d).state).toBe('up-to-date');
    }
  });

  it('does not try to compile when the new version ships dist/ prebuilt', () => {
    const { base, origin, release } = makeOrigin();
    const clone = path.join(base, 'c'); g(base, 'clone', '-q', origin, clone);
    fs.mkdirSync(path.join(clone, 'node_modules')); // looks like a dev checkout: would normally trigger npm install/compile
    const work = path.join(base, 'work');
    fs.mkdirSync(path.join(work, 'dist', 'cli'), { recursive: true }); fs.writeFileSync(path.join(work, 'dist', 'cli', 'index.js'), '//');
    g(work, 'add', '.'); release('1.4.0');
    const r = updateCheckout(clone);
    expect(r.state).toBe('updated');
    expect(r.message).not.toMatch(/rebuilt|compile/);
  });

  it('leaves a copy with uncommitted changes or unpushed commits alone', () => {
    const { base, origin, release } = makeOrigin();
    const dirty = path.join(base, 'dirty'); g(base, 'clone', '-q', origin, dirty);
    const ahead = path.join(base, 'ahead'); g(base, 'clone', '-q', origin, ahead);
    release('1.3.0');
    fs.appendFileSync(path.join(dirty, 'SKILL.md'), 'local edit');
    expect(updateCheckout(dirty).state).toBe('skipped');
    expect(fs.readFileSync(path.join(dirty, 'SKILL.md'), 'utf8')).toBe('xlocal edit');
    fs.writeFileSync(path.join(ahead, 'mine.txt'), '1'); g(ahead, 'add', '.'); g(ahead, 'commit', '-qm', 'mine');
    expect(updateCheckout(ahead).state).toBe('skipped');
  });

  it('only recognises real FThisUp checkouts, never other repos', () => {
    const { base } = makeOrigin();
    const other = path.join(base, 'other'); fs.mkdirSync(other); g(other, 'init', '-q'); g(other, 'remote', 'add', 'origin', 'https://github.com/someone/else');
    fs.writeFileSync(path.join(other, 'package.json'), '{"name":"else"}');
    expect(isFThisUpCheckout(other)).toBe(false);
    const found = findInstalls({ selfRoot: other, cwd: base, home: base });
    expect(found.checkouts).toEqual([]);
  });
});
