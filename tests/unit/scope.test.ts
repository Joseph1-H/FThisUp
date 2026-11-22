import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { confine, findProjectRoot, isInside, ProjectScopeError } from '../../src/utils/project-root.js';
import { ownerBelongsToProject } from '../../src/safety/scope.js';
import { configSchema } from '../../src/core/config.js';
import { evaluateTarget, SafetyGuard } from '../../src/safety/policy.js';
import { bareDir, tmpDir } from '../helpers.js';

describe('findProjectRoot', () => {
  it('walks up to the nearest project marker', () => {
    const proj = tmpDir(); const deep = path.join(proj, 'a', 'b'); fs.mkdirSync(deep, { recursive: true });
    expect(findProjectRoot(deep)).toBe(proj);
  });
  it('throws outside a project', () => expect(() => findProjectRoot(bareDir())).toThrow(ProjectScopeError));
  it('never returns the home directory or the filesystem root', () => {
    expect(() => findProjectRoot(os.homedir())).toThrow(ProjectScopeError);
    expect(() => findProjectRoot(path.parse(process.cwd()).root)).toThrow(ProjectScopeError);
  });
});

describe('confine / isInside', () => {
  const proj = tmpDir();
  it('allows paths inside, including not-yet-existing ones', () => {
    expect(confine(proj, './out', 'x')).toBe(path.join(proj, 'out'));
    expect(isInside(proj, path.join(proj, 'a', 'b', 'c'))).toBe(true);
  });
  it.each(['..', '../x', '/etc/passwd', path.join(os.tmpdir(), 'zzz')])('rejects %s', (p) => {
    expect(() => confine(proj, p, 'path')).toThrow(/outside the project/);
  });
  it('does not treat a sibling with the same prefix as inside', () => {
    expect(isInside(proj, `${proj}-evil/x`)).toBe(false);
  });
  it('rejects symlink escapes', () => {
    const elsewhere = bareDir();
    try { fs.symlinkSync(elsewhere, path.join(proj, 'lnk'), 'dir'); } catch { return; }
    expect(isInside(proj, path.join(proj, 'lnk', 'file'))).toBe(false);
  });
});

describe('ownerBelongsToProject', () => {
  const proj = tmpDir();
  it('accepts a server started in the project or a subfolder', () => {
    expect(ownerBelongsToProject(proj, proj)).toBe(true);
    expect(ownerBelongsToProject(path.join(proj, 'server'), proj)).toBe(true);
  });
  it('accepts a monorepo-root parent, but not $HOME or /', () => {
    const mono = tmpDir(); const pkg = path.join(mono, 'packages', 'app'); fs.mkdirSync(pkg, { recursive: true });
    expect(ownerBelongsToProject(mono, pkg)).toBe(true);
    expect(ownerBelongsToProject(os.homedir(), path.join(os.homedir(), 'x'))).toBe(false);
    expect(ownerBelongsToProject('/', proj)).toBe(false);
  });
  it('rejects another project', () => expect(ownerBelongsToProject(tmpDir(), proj)).toBe(false));
});

describe('SafetyGuard: other local servers', () => {
  const cfg = configSchema.parse({});
  const mk = (foreign: number[]) => new SafetyGuard(evaluateTarget('http://localhost:3000', cfg), cfg, { isForeignPort: (p) => foreign.includes(p) });
  it('allows a sibling loopback API port of this project', async () => {
    expect((await mk([]).checkRequest('http://localhost:8000/api', 'GET', 'fetch')).allow).toBe(true);
  });
  it('never contacts a loopback port owned by another project', async () => {
    expect(await mk([9000]).checkRequest('http://localhost:9000/api', 'GET', 'fetch')).toMatchObject({ allow: false, kind: 'external' });
    expect((await mk([9000]).checkRequest('http://localhost:3000/x', 'GET', 'fetch')).allow).toBe(true);
  });
});
