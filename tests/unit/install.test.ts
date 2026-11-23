import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from '../helpers.js';
import { isGlobalNpmInstall } from '../../src/cli/update.js';

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string>; bin: Record<string, string>; files: string[] };

describe('GitHub install guard (regression: "tsc: not found", exit 127)', () => {
  it('has no lifecycle script that makes npm "prepare" the git checkout', () => {
    // pacote runs a nested `npm install` for git dependencies that define any of these. Under `npm install -g`
    // that nested install does not install devDependencies, so a compile step there fails with exit 127.
    for (const s of ['preinstall', 'install', 'postinstall', 'build', 'prepack', 'prepare']) {
      expect(Object.keys(pkg.scripts), `scripts.${s} would trigger git-dependency preparation`).not.toContain(s);
    }
  });
  it('ships the compiled CLI in git, so no compiler is needed on the user machine', () => {
    const tracked = execFileSync('git', ['ls-files', '--', pkg.bin.fthisup!, 'dist/adapters/harness/fuzz-node.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(tracked).toContain('dist/cli/index.js');
    expect(tracked).toContain('fuzz-node.mjs');
    expect(pkg.files).toContain('dist');
    expect(pkg.files).toContain('skills');
  });
  it('recognises a global npm install but not an npx cache or a dev checkout', () => {
    const s = path.sep;
    expect(isGlobalNpmInstall(['', 'usr', 'lib', 'node_modules', 'fthisup'].join(s))).toBe(true);
    expect(isGlobalNpmInstall(['', 'h', '.npm', '_npx', 'abc', 'node_modules', 'fthisup'].join(s))).toBe(false);
    expect(isGlobalNpmInstall(['', 'data', 'projects', 'FThisUp'].join(s))).toBe(false);
  });
});
