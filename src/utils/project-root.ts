import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MARKERS = ['fthisup.config.json', 'package.json', 'pyproject.toml', 'requirements.txt', 'setup.py', 'pubspec.yaml', 'go.mod', 'Cargo.toml', 'composer.json', 'Gemfile', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'CMakeLists.txt', 'meson.build', 'Makefile', 'Package.swift', 'project.godot', '.git'];

const real = (p: string) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

export class ProjectScopeError extends Error {}

/** Nearest ancestor of `start` that looks like a project. Never returns the home directory or a filesystem root. */
export function findProjectRoot(start: string): string {
  const home = real(os.homedir());
  let dir = real(start);
  for (let i = 0; i < 12; i++) {
    if (dir === home || dir === path.parse(dir).root) break;
    if (MARKERS.some((m) => fs.existsSync(path.join(dir, m)))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new ProjectScopeError(
    `${start} is not inside a project (no package.json, pyproject.toml, Cargo.toml, go.mod, pubspec.yaml, CMakeLists.txt, pom.xml, .git, ... found, and your home directory / filesystem root are never treated as a project). FThisUp only works on the project you run it in: cd into it first.`,
  );
}

/** True if `child` is `root` or inside it (symlinks resolved, for paths that may not exist yet). */
export function isInside(root: string, child: string): boolean {
  const r = real(root);
  let c = path.resolve(child);
  const tail: string[] = [];
  while (!fs.existsSync(c) && path.dirname(c) !== c) { tail.unshift(path.basename(c)); c = path.dirname(c); }
  const full = path.join(real(c), ...tail);
  const rel = path.relative(r, full);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Resolve a user-supplied path against the project root and refuse anything outside it. */
export function confine(root: string, p: string, label: string): string {
  const abs = path.resolve(root, p);
  if (!isInside(root, abs)) throw new ProjectScopeError(`${label} "${p}" is outside the project (${root}). FThisUp only reads and writes inside the project it is run in.`);
  return abs;
}
