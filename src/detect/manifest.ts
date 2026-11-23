import fs from 'node:fs';
import path from 'node:path';
import type { Confidence } from '../core/types.js';
import { readJsonSafe } from '../utils/files.js';
import { pythonExe, pythonHasModule, toolVersion, which } from '../exec/tools.js';

export type Ecosystem = 'node' | 'python' | 'rust' | 'go' | 'flutter' | 'java' | 'cpp' | 'swift' | 'godot' | 'dotnet' | 'ruby' | 'php' | 'static-web';
export type Role = 'web-app' | 'api' | 'cli' | 'library' | 'mobile-app' | 'desktop-app' | 'game' | 'unknown';
export type RunnerId =
  | 'npm-test' | 'node-test' | 'vitest' | 'jest' | 'mocha'
  | 'pytest' | 'unittest' | 'cargo' | 'go' | 'flutter' | 'dart' | 'maven' | 'gradle' | 'ctest' | 'make' | 'swift' | 'meson';

export interface TestCommand {
  runner: RunnerId;
  file: string;
  args: string[];
  /** relative to the component directory */
  source: string;
  available: boolean;
  /** why it is unavailable */
  reason?: string;
  /** user-run command that would fix it (FThisUp never runs it) */
  setup?: string;
}

export interface Component {
  id: string;
  /** posix path relative to the project root ('.' for the root) */
  path: string;
  ecosystem: Ecosystem;
  roles: Role[];
  languages: string[];
  frameworks: string[];
  buildSystems: string[];
  packageManagers: string[];
  testFrameworks: string[];
  entryPoints: string[];
  integrations: string[];
  testFiles: number;
  testCommands: TestCommand[];
  /** extra analysis commands (flutter analyze ...) */
  analyzers: TestCommand[];
  confidence: Confidence;
  evidence: string[];
  notes: string[];
  /** candidate adapter ids (candidate != available; the adapter decides) */
  adapters: string[];
}

export interface ProjectManifest {
  schemaVersion: 1;
  root: string;
  generatedAt: string;
  components: Component[];
  tools: Record<string, string | null>;
  notes: string[];
}

const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', 'coverage', 'fthisup-results', '.fthisup-tmp', 'vendor', '.venv', 'venv', 'env', '__pycache__', 'target', 'Pods', '.gradle', '.dart_tool', '.idea', '.vscode', '.pytest_cache', 'site-packages', 'fixtures', '.godot']);
const MAX_DEPTH = 3;

const rel = (root: string, dir: string) => path.relative(root, dir).split(path.sep).join('/') || '.';
const has = (dir: string, f: string) => fs.existsSync(path.join(dir, f));
const read = (p: string) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };

function walkDirs(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string, depth: number) => {
    out.push(dir);
    if (depth >= MAX_DEPTH) return;
    let ents: fs.Dirent[] = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!e.isDirectory() || e.isSymbolicLink() || IGNORE.has(e.name) || e.name.startsWith('.')) continue;
      visit(path.join(dir, e.name), depth + 1);
    }
  };
  visit(root, 0);
  return out;
}

function countFiles(dir: string, re: RegExp, limit = 2000): number {
  let n = 0;
  const visit = (d: string, depth: number) => {
    if (depth > 6 || n >= limit) return;
    let ents: fs.Dirent[] = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isDirectory()) { if (!IGNORE.has(e.name) && !e.name.startsWith('.')) visit(path.join(d, e.name), depth + 1); }
      else if (re.test(e.name)) n++;
    }
  };
  visit(dir, 0);
  return n;
}

function mk(root: string, dir: string, eco: Ecosystem, confidence: Confidence, evidence: string[]): Component {
  const r = rel(root, dir);
  return {
    id: `${eco}:${r}`, path: r, ecosystem: eco, roles: [], languages: [], frameworks: [], buildSystems: [], packageManagers: [], testFrameworks: [],
    entryPoints: [], integrations: [], testFiles: 0, testCommands: [], analyzers: [], confidence, evidence, notes: [], adapters: [],
  };
}

function cmd(runner: RunnerId, file: string, args: string[], source: string, tool: string | null, setup?: string, extra?: { missingDeps?: string }): TestCommand {
  if (tool === null || !which(tool)) return { runner, file, args, source, available: false, reason: `${tool ?? file} is not installed or not on PATH`, setup };
  if (extra?.missingDeps) return { runner, file, args, source, available: false, reason: extra.missingDeps, setup };
  return { runner, file, args, source, available: true };
}

// ---------------------------------------------------------------- node
const NODE_WEB = ['next', 'nuxt', '@sveltejs/kit', '@remix-run/react', 'astro', '@angular/core', 'react-scripts', 'vite', 'vue', 'svelte', 'react', 'solid-js', 'preact'];
const NODE_API = ['express', 'fastify', 'koa', 'hono', '@nestjs/core', 'restify', '@hapi/hapi', 'apollo-server', 'graphql-yoga'];
const INTEGRATIONS: Record<string, string> = { '@supabase/supabase-js': 'Supabase', firebase: 'Firebase', 'firebase-admin': 'Firebase', prisma: 'Prisma', '@prisma/client': 'Prisma', mongoose: 'MongoDB', pg: 'PostgreSQL', mysql2: 'MySQL', redis: 'Redis', stripe: 'Stripe', supabase_flutter: 'Supabase', 'cloud_firestore': 'Firebase', firebase_core: 'Firebase' };

function detectNode(root: string, dir: string): Component {
  const pkgPath = path.join(dir, 'package.json');
  const pkg = readJsonSafe<{ name?: string; bin?: string | Record<string, string>; main?: string; exports?: unknown; scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; workspaces?: unknown }>(pkgPath) ?? {};
  const c = mk(root, dir, 'node', 'high', ['package.json']);
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const d = (n: string) => n in deps;
  c.languages.push(has(dir, 'tsconfig.json') || d('typescript') ? 'TypeScript' : 'JavaScript');
  c.packageManagers.push(has(dir, 'pnpm-lock.yaml') ? 'pnpm' : has(dir, 'yarn.lock') ? 'yarn' : has(dir, 'bun.lockb') || has(dir, 'bun.lock') ? 'bun' : 'npm');
  for (const w of NODE_WEB) if (d(w) && !c.frameworks.includes(w)) c.frameworks.push(w);
  for (const a of NODE_API) if (d(a)) c.frameworks.push(a);
  for (const [k, v] of Object.entries(INTEGRATIONS)) if (d(k) && !c.integrations.includes(v)) c.integrations.push(v);
  const frontend = NODE_WEB.some(d);
  const backend = NODE_API.some(d);
  if (d('electron')) { c.roles.push('desktop-app'); c.frameworks.push('electron'); }
  if (d('react-native') || d('expo')) { c.roles.push('mobile-app'); c.frameworks.push(d('expo') ? 'expo' : 'react-native'); c.notes.push('React Native/Expo is detected but not testable by FThisUp yet.'); }
  if (frontend && !d('react-native')) c.roles.push('web-app');
  if (backend || ['next', 'nuxt', '@sveltejs/kit', '@remix-run/react'].some(d)) c.roles.push('api');
  const bins = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin ?? {});
  if (bins.length) { c.roles.push('cli'); c.entryPoints.push(...bins.map((b) => `bin: ${b}`)); }
  if (pkg.main) c.entryPoints.push(`main: ${pkg.main}`);
  if (!c.roles.length) c.roles.push(pkg.main || pkg.exports ? 'library' : 'unknown');
  c.buildSystems.push(...(pkg.scripts?.build ? ['npm scripts (build)'] : []), ...(d('vite') ? ['vite'] : []), ...(d('webpack') ? ['webpack'] : []), ...(d('typescript') ? ['tsc'] : []));

  const tfiles = countFiles(dir, /\.(test|spec)\.[cm]?[jt]sx?$/) + countFiles(path.join(dir, 'test'), /\.[cm]?[jt]sx?$/) + countFiles(path.join(dir, 'tests'), /\.[cm]?[jt]sx?$/);
  c.testFiles = tfiles;
  const usesNodeTest = tfiles > 0 && fileUses(dir, /\.[cm]?[jt]s$/, /from ['"]node:test['"]|require\(['"]node:test['"]\)/);
  for (const t of ['vitest', 'jest', 'mocha', '@playwright/test', 'cypress', 'ava']) if (d(t)) c.testFrameworks.push(t);
  if (usesNodeTest) c.testFrameworks.push('node:test');
  const needDeps = Object.keys(deps).length > 0 && !has(dir, 'node_modules');
  const depsMsg = needDeps ? 'dependencies are not installed (no node_modules)' : undefined;
  const pm = c.packageManagers[0]!;
  const install = `${pm} install`;
  const script = pkg.scripts?.test;
  const placeholder = !script || /no test specified/i.test(script);
  if (!placeholder) {
    c.testCommands.push(cmd('npm-test', pm === 'yarn' ? 'yarn' : pm, pm === 'yarn' ? ['test'] : ['test'], `package.json scripts.test = "${script}"`, pm, undefined, { missingDeps: depsMsg }));
    if (c.testCommands[0] && !c.testCommands[0].available && depsMsg) c.testCommands[0].setup = install;
  } else if (usesNodeTest) {
    c.testCommands.push(cmd('node-test', 'node', ['--test'], 'node:test imports found in test files', 'node'));
  } else if (d('vitest')) c.testCommands.push(cmd('vitest', 'npx', ['--no-install', 'vitest', 'run'], 'vitest dependency', 'npx', install, { missingDeps: depsMsg }));
  else if (d('jest')) c.testCommands.push(cmd('jest', 'npx', ['--no-install', 'jest'], 'jest dependency', 'npx', install, { missingDeps: depsMsg }));
  else if (d('mocha')) c.testCommands.push(cmd('mocha', 'npx', ['--no-install', 'mocha'], 'mocha dependency', 'npx', install, { missingDeps: depsMsg }));
  if (d('typescript') && has(dir, 'tsconfig.json')) c.analyzers.push(cmd('npm-test', 'npx', ['--no-install', 'tsc', '--noEmit'], 'tsc type-check (tsconfig.json)', 'npx', install, { missingDeps: depsMsg }));
  return c;
}

function fileUses(dir: string, nameRe: RegExp, contentRe: RegExp): boolean {
  let found = false;
  const visit = (d: string, depth: number) => {
    if (found || depth > 5) return;
    let ents: fs.Dirent[] = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (found) return;
      if (e.isDirectory()) { if (!IGNORE.has(e.name) && !e.name.startsWith('.')) visit(path.join(d, e.name), depth + 1); }
      else if (nameRe.test(e.name) && contentRe.test(read(path.join(d, e.name)).slice(0, 20000))) found = true;
    }
  };
  visit(dir, 0);
  return found;
}

// ---------------------------------------------------------------- python
function detectPython(root: string, dir: string): Component {
  const marks = ['pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg', 'Pipfile'].filter((m) => has(dir, m));
  const c = mk(root, dir, 'python', 'high', marks);
  c.languages.push('Python');
  const text = marks.map((m) => read(path.join(dir, m))).join('\n').toLowerCase();
  c.packageManagers.push(has(dir, 'poetry.lock') ? 'poetry' : has(dir, 'Pipfile') ? 'pipenv' : has(dir, 'uv.lock') ? 'uv' : 'pip');
  c.buildSystems.push(...(has(dir, 'pyproject.toml') ? ['pyproject'] : []), ...(has(dir, 'setup.py') ? ['setuptools'] : []));
  for (const [k, n] of [['fastapi', 'FastAPI'], ['flask', 'Flask'], ['django', 'Django'], ['starlette', 'Starlette'], ['aiohttp', 'aiohttp'], ['click', 'Click'], ['typer', 'Typer']] as const) if (new RegExp(`(^|[^a-z])${k}([^a-z]|$)`).test(text)) c.frameworks.push(n);
  const tfiles = countFiles(dir, /^(test_.*|.*_test)\.py$/);
  c.testFiles = tfiles;
  const pyFiles = (re: RegExp) => fileUses(dir, /\.py$/, re);
  const usesPytest = /pytest/.test(text) || has(dir, 'pytest.ini') || has(dir, 'conftest.py') || has(dir, 'tox.ini') && /pytest/.test(read(path.join(dir, 'tox.ini'))) || (tfiles > 0 && pyFiles(/^\s*(import pytest|from pytest)/m));
  const usesUnittest = tfiles > 0 && pyFiles(/^\s*(import unittest|from unittest)/m);
  if (usesPytest) c.testFrameworks.push('pytest');
  if (usesUnittest) c.testFrameworks.push('unittest');
  if (/hypothesis/.test(text) || (tfiles > 0 && pyFiles(/from hypothesis|import hypothesis/))) c.testFrameworks.push('hypothesis');
  if (c.frameworks.some((f) => ['FastAPI', 'Flask', 'Django', 'Starlette', 'aiohttp'].includes(f))) c.roles.push('api');
  if (/\[project\.scripts\]|console_scripts|\[tool\.poetry\.scripts\]/.test(text) || c.frameworks.some((f) => ['Click', 'Typer'].includes(f)) || has(dir, '__main__.py') || has(dir, 'main.py') && pyFiles(/argparse/)) c.roles.push('cli');
  if (!c.roles.length) c.roles.push('library');
  if (has(dir, '__main__.py')) c.entryPoints.push('__main__.py');
  for (const [k, v] of Object.entries(INTEGRATIONS)) if (text.includes(k.replace('@', '').replace('/', '-'))) c.integrations.push(v);
  const py = pythonExe();
  const none = (): TestCommand => ({ runner: 'unittest', file: 'python3', args: ['-m', 'unittest', 'discover'], source: 'python', available: false, reason: 'Python is not installed', setup: 'install Python 3' });
  if (usesPytest) {
    c.testCommands.push(py && pythonHasModule('pytest', dir)
      ? { runner: 'pytest', file: py, args: ['-m', 'pytest'], source: 'pytest configuration / dependency', available: true }
      : { runner: 'pytest', file: py ?? 'python3', args: ['-m', 'pytest'], source: 'pytest configuration / dependency', available: false, reason: py ? 'pytest is not installed in this Python environment' : 'Python is not installed', setup: 'python3 -m pip install pytest   (ideally inside a virtualenv)' });
  }
  if (usesUnittest || (!usesPytest && tfiles > 0)) {
    c.testCommands.push(py ? { runner: 'unittest', file: py, args: ['-m', 'unittest', 'discover', '-v'], source: 'unittest-style tests found', available: true } : none());
  }
  c.adapters.push('python');
  return c;
}

// ---------------------------------------------------------------- rust
function detectRust(root: string, dir: string): Component {
  const toml = read(path.join(dir, 'Cargo.toml'));
  const c = mk(root, dir, 'rust', 'high', ['Cargo.toml']);
  c.languages.push('Rust'); c.buildSystems.push('cargo'); c.packageManagers.push('cargo');
  const workspace = /^\[workspace\]/m.test(toml);
  const isBin = has(dir, 'src/main.rs') || /^\[\[bin\]\]/m.test(toml);
  const isLib = has(dir, 'src/lib.rs') || /^\[lib\]/m.test(toml);
  for (const [k, n] of [['axum', 'axum'], ['actix-web', 'actix-web'], ['rocket', 'rocket'], ['warp', 'warp'], ['tokio', 'tokio'], ['clap', 'clap']] as const) if (new RegExp(`^${k}\\s*=`, 'm').test(toml) || toml.includes(`"${k}"`)) c.frameworks.push(n);
  if (c.frameworks.some((f) => ['axum', 'actix-web', 'rocket', 'warp'].includes(f))) c.roles.push('api');
  if (isBin) { c.roles.push('cli'); c.entryPoints.push('src/main.rs'); }
  if (isLib) c.roles.push('library');
  if (!c.roles.length) c.roles.push(workspace ? 'library' : 'unknown');
  c.testFiles = countFiles(path.join(dir, 'tests'), /\.rs$/) + countFiles(path.join(dir, 'src'), /\.rs$/) * 0;
  const inline = fileUses(path.join(dir, 'src'), /\.rs$/, /#\[(cfg\(test\)|test)\]/);
  if (c.testFiles > 0 || inline) c.testFrameworks.push('cargo test');
  c.testCommands.push(cmd('cargo', 'cargo', workspace ? ['test', '--workspace', '--no-fail-fast'] : ['test', '--no-fail-fast'], 'Cargo.toml', 'cargo', 'install Rust via https://rustup.rs'));
  c.analyzers.push(cmd('cargo', 'cargo', ['clippy', '--all-targets'], 'Cargo.toml (clippy)', which('cargo-clippy') || toolVersion('cargo', ['clippy', '--version']) ? 'cargo' : null, 'rustup component add clippy'));
  c.adapters.push('rust');
  return c;
}

// ---------------------------------------------------------------- go
function detectGo(root: string, dir: string): Component {
  const mod = read(path.join(dir, 'go.mod'));
  const c = mk(root, dir, 'go', 'high', ['go.mod']);
  c.languages.push('Go'); c.buildSystems.push('go modules'); c.packageManagers.push('go');
  c.testFiles = countFiles(dir, /_test\.go$/);
  if (c.testFiles) c.testFrameworks.push('go test');
  for (const [k, n] of [['gin-gonic/gin', 'gin'], ['labstack/echo', 'echo'], ['gofiber/fiber', 'fiber'], ['go-chi/chi', 'chi'], ['gorilla/mux', 'gorilla/mux'], ['spf13/cobra', 'cobra']] as const) if (mod.includes(k)) c.frameworks.push(n);
  if (c.frameworks.some((f) => ['gin', 'echo', 'fiber', 'chi', 'gorilla/mux'].includes(f))) c.roles.push('api');
  if (has(dir, 'main.go') || has(dir, 'cmd') || c.frameworks.includes('cobra')) { c.roles.push('cli'); c.entryPoints.push(has(dir, 'main.go') ? 'main.go' : 'cmd/'); }
  if (!c.roles.length) c.roles.push('library');
  c.testCommands.push(cmd('go', 'go', ['test', '-json', './...'], 'go.mod', 'go', 'install Go from https://go.dev/dl/'));
  c.analyzers.push(cmd('go', 'go', ['vet', './...'], 'go.mod (go vet)', 'go', 'install Go from https://go.dev/dl/'));
  c.adapters.push('go');
  return c;
}

// ---------------------------------------------------------------- flutter / dart
function detectFlutter(root: string, dir: string): Component {
  const y = read(path.join(dir, 'pubspec.yaml'));
  const isFlutter = /^\s*flutter:\s*$/m.test(y) || /sdk:\s*flutter/.test(y);
  const c = mk(root, dir, 'flutter', 'high', ['pubspec.yaml']);
  c.languages.push('Dart'); c.buildSystems.push('pub'); c.packageManagers.push('pub');
  if (isFlutter) {
    c.frameworks.push('Flutter');
    const platforms = ['android', 'ios', 'web', 'linux', 'macos', 'windows'].filter((p) => has(dir, p));
    if (platforms.some((p) => ['android', 'ios'].includes(p))) c.roles.push('mobile-app');
    if (platforms.some((p) => ['linux', 'macos', 'windows'].includes(p))) c.roles.push('desktop-app');
    if (platforms.includes('web')) c.roles.push('web-app');
    if (!c.roles.length) c.roles.push('mobile-app');
    c.notes.push(`Flutter platforms present: ${platforms.join(', ') || 'none'}.`);
  } else c.roles.push(has(dir, 'bin') ? 'cli' : 'library');
  for (const [k, v] of Object.entries(INTEGRATIONS)) if (new RegExp(`^\\s*${k}\\s*:`, 'm').test(y)) c.integrations.push(v);
  c.testFiles = countFiles(path.join(dir, 'test'), /_test\.dart$/);
  const integ = countFiles(path.join(dir, 'integration_test'), /_test\.dart$/);
  if (c.testFiles) c.testFrameworks.push(isFlutter ? 'flutter_test' : 'package:test');
  if (integ) { c.testFrameworks.push('integration_test'); c.notes.push(`${integ} integration_test file(s) found; they need a device/emulator and are NOT run unless one is configured.`); }
  const tool = isFlutter ? 'flutter' : 'dart';
  const setup = isFlutter ? 'install Flutter: https://docs.flutter.dev/get-started/install' : 'install the Dart SDK: https://dart.dev/get-dart';
  if (c.testFiles) c.testCommands.push(cmd(isFlutter ? 'flutter' : 'dart', tool, isFlutter ? ['test', '--reporter', 'json'] : ['test', '--reporter', 'json'], 'pubspec.yaml + test/', tool, setup));
  c.analyzers.push(cmd(isFlutter ? 'flutter' : 'dart', tool, ['analyze'], `${tool} analyze`, tool, setup));
  c.adapters.push('flutter');
  return c;
}

// ---------------------------------------------------------------- java / kotlin
function detectJava(root: string, dir: string): Component {
  const maven = has(dir, 'pom.xml');
  const gradleFile = ['build.gradle', 'build.gradle.kts'].find((f) => has(dir, f));
  const c = mk(root, dir, 'java', 'high', [maven ? 'pom.xml' : gradleFile!]);
  const text = read(path.join(dir, maven ? 'pom.xml' : gradleFile!));
  c.languages.push(gradleFile?.endsWith('.kts') || /kotlin/.test(text) ? 'Kotlin' : 'Java');
  c.buildSystems.push(maven ? 'maven' : 'gradle'); c.packageManagers.push(maven ? 'maven' : 'gradle');
  for (const [k, n] of [['spring-boot', 'Spring Boot'], ['ktor', 'Ktor'], ['quarkus', 'Quarkus'], ['micronaut', 'Micronaut']] as const) if (text.includes(k)) c.frameworks.push(n);
  const android = /com\.android\.(application|library)/.test(text) || has(dir, 'AndroidManifest.xml') || has(dir, 'src/main/AndroidManifest.xml');
  if (android) { c.roles.push('mobile-app'); c.frameworks.push('Android'); c.notes.push('Android projects: unit tests via Gradle may run; instrumented/device tests are NOT run.'); }
  else if (c.frameworks.length) c.roles.push('api');
  else c.roles.push('library');
  c.testFiles = countFiles(path.join(dir, 'src', 'test'), /\.(java|kt)$/);
  if (c.testFiles) c.testFrameworks.push(/junit-jupiter|org\.junit\.jupiter/.test(text) ? 'JUnit 5' : /junit/i.test(text) ? 'JUnit' : 'JVM tests');
  const wrapper = has(dir, maven ? 'mvnw' : 'gradlew') ? `./${maven ? 'mvnw' : 'gradlew'}` : null;
  if (maven) c.testCommands.push(wrapper ? { runner: 'maven', file: wrapper, args: ['-B', 'test'], source: 'pom.xml + mvnw', available: !!which('java'), reason: which('java') ? undefined : 'java is not installed' } : cmd('maven', 'mvn', ['-B', 'test'], 'pom.xml', 'mvn', 'install Maven (https://maven.apache.org) or add the Maven wrapper'));
  else c.testCommands.push(wrapper ? { runner: 'gradle', file: wrapper, args: ['test', '--console=plain'], source: `${gradleFile} + gradlew`, available: !!which('java'), reason: which('java') ? undefined : 'java is not installed' } : cmd('gradle', 'gradle', ['test', '--console=plain'], gradleFile!, 'gradle', 'install Gradle (https://gradle.org) or add the Gradle wrapper'));
  if (!c.testFiles) c.testCommands.length = 0;
  c.adapters.push('java');
  return c;
}

// ---------------------------------------------------------------- c / c++
function detectCpp(root: string, dir: string): Component {
  const cmake = has(dir, 'CMakeLists.txt'), meson = has(dir, 'meson.build'), make = ['Makefile', 'makefile', 'GNUmakefile'].find((f) => has(dir, f));
  const c = mk(root, dir, 'cpp', 'high', [cmake ? 'CMakeLists.txt' : meson ? 'meson.build' : make!]);
  c.languages.push(countFiles(dir, /\.(cpp|cc|cxx|hpp)$/) ? 'C++' : 'C');
  c.buildSystems.push(cmake ? 'cmake' : meson ? 'meson' : 'make'); c.packageManagers.push(has(dir, 'conanfile.txt') ? 'conan' : has(dir, 'vcpkg.json') ? 'vcpkg' : 'none');
  const text = cmake ? read(path.join(dir, 'CMakeLists.txt')) : meson ? read(path.join(dir, 'meson.build')) : read(path.join(dir, make!));
  c.roles.push(/add_executable|executable\(/.test(text) ? 'cli' : 'library');
  const hasTests = cmake ? /enable_testing|add_test\(/.test(text) : meson ? /test\(/.test(text) : /^(test|check):/m.test(text);
  if (hasTests) c.testFrameworks.push(cmake ? 'ctest' : meson ? 'meson test' : 'make test');
  c.testFiles = hasTests ? 1 : 0;
  if (hasTests && cmake) c.testCommands.push(cmd('ctest', 'cmake', [], 'CMakeLists.txt (enable_testing/add_test)', which('cmake') && which('ctest') && (which('make') || which('ninja') || which('cc') || which('gcc') || which('clang')) ? 'cmake' : null, 'install cmake, a C/C++ compiler and make/ninja'));
  else if (hasTests && meson) c.testCommands.push(cmd('meson', 'meson', ['test', '-C', 'builddir'], 'meson.build', 'meson', 'install Meson (https://mesonbuild.com)'));
  else if (hasTests) c.testCommands.push(cmd('make', 'make', [/^check:/m.test(text) && !/^test:/m.test(text) ? 'check' : 'test'], `${make}`, 'make', 'install make'));
  c.adapters.push('cpp');
  return c;
}

// ---------------------------------------------------------------- swift
function detectSwift(root: string, dir: string): Component {
  const c = mk(root, dir, 'swift', 'high', ['Package.swift']);
  c.languages.push('Swift'); c.buildSystems.push('swift package manager'); c.packageManagers.push('swiftpm');
  const text = read(path.join(dir, 'Package.swift'));
  c.roles.push(/\.executableTarget|\.executable\(/.test(text) ? 'cli' : 'library');
  c.testFiles = countFiles(path.join(dir, 'Tests'), /\.swift$/);
  if (c.testFiles) c.testFrameworks.push(/swift-testing|import Testing/.test(text) ? 'Swift Testing' : 'XCTest');
  if (c.testFiles) c.testCommands.push(cmd('swift', 'swift', ['test'], 'Package.swift + Tests/', 'swift', 'install the Swift toolchain: https://www.swift.org/install'));
  c.adapters.push('swift');
  return c;
}

// ---------------------------------------------------------------- godot
function detectGodot(root: string, dir: string): Component {
  const c = mk(root, dir, 'godot', 'high', ['project.godot']);
  const text = read(path.join(dir, 'project.godot'));
  c.languages.push(countFiles(dir, /\.cs$/) ? 'C#' : 'GDScript'); c.buildSystems.push('godot'); c.roles.push('game');
  const v = /config\/features=PackedStringArray\("([\d.]+)"/.exec(text)?.[1];
  if (v) c.frameworks.push(`Godot ${v}`); else c.frameworks.push('Godot');
  const main = /run\/main_scene="([^"]+)"/.exec(text)?.[1];
  if (main) c.entryPoints.push(main);
  for (const fw of ['gut', 'gdUnit4', 'gdunit4']) if (fs.existsSync(path.join(dir, 'addons', fw))) c.testFrameworks.push(fw);
  c.testFiles = countFiles(path.join(dir, 'test'), /\.gd$/) + countFiles(path.join(dir, 'tests'), /\.gd$/);
  c.adapters.push('godot');
  return c;
}

export function detectProjectManifest(root: string): ProjectManifest {
  const comps: Component[] = [];
  for (const dir of walkDirs(root)) {
    if (has(dir, 'package.json')) comps.push(detectNode(root, dir));
    if (['pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg', 'Pipfile'].some((m) => has(dir, m))) comps.push(detectPython(root, dir));
    if (has(dir, 'Cargo.toml')) comps.push(detectRust(root, dir));
    if (has(dir, 'go.mod')) comps.push(detectGo(root, dir));
    if (has(dir, 'pubspec.yaml')) comps.push(detectFlutter(root, dir));
    if (has(dir, 'pom.xml') || has(dir, 'build.gradle') || has(dir, 'build.gradle.kts')) comps.push(detectJava(root, dir));
    if (has(dir, 'CMakeLists.txt') || has(dir, 'meson.build') || (['Makefile', 'makefile', 'GNUmakefile'].some((m) => has(dir, m)) && countFiles(dir, /\.(c|cc|cpp|cxx)$/, 5) > 0)) comps.push(detectCpp(root, dir));
    if (has(dir, 'Package.swift')) comps.push(detectSwift(root, dir));
    if (has(dir, 'project.godot')) comps.push(detectGodot(root, dir));
    if (fs.readdirSync(dir).some((f) => /\.(csproj|fsproj|sln)$/.test(f))) { const c = mk(root, dir, 'dotnet', 'medium', ['.csproj/.sln']); c.languages.push('C#'); c.roles.push('unknown'); c.notes.push('.NET is detected but not supported by any FThisUp adapter yet.'); comps.push(c); }
    if (has(dir, 'Gemfile')) { const c = mk(root, dir, 'ruby', 'medium', ['Gemfile']); c.languages.push('Ruby'); c.roles.push('unknown'); c.notes.push('Ruby is detected but not supported by any FThisUp adapter yet.'); comps.push(c); }
    if (has(dir, 'composer.json')) { const c = mk(root, dir, 'php', 'medium', ['composer.json']); c.languages.push('PHP'); c.roles.push('unknown'); c.notes.push('PHP is detected but not supported by any FThisUp adapter yet.'); comps.push(c); }
  }
  // a package.json-less static site
  if (!comps.length && has(root, 'index.html')) {
    const c = mk(root, root, 'static-web', 'medium', ['index.html']); c.languages.push('HTML'); c.roles.push('web-app'); comps.push(c);
  }
  // roles imply adapters (candidates only)
  for (const c of comps) {
    if (c.roles.includes('web-app')) c.adapters.push('web');
    if (c.roles.includes('api')) c.adapters.push('api');
    if (c.roles.includes('cli')) c.adapters.push('cli');
    if (c.roles.includes('desktop-app')) c.adapters.push('desktop');
    if (c.ecosystem === 'node') c.adapters.push('javascript');
    c.adapters = [...new Set(c.adapters)];
  }
  const tools: Record<string, string | null> = {};
  for (const [name, args] of [['node', ['--version']], ['python3', ['--version']], ['cargo', ['--version']], ['go', ['version']], ['flutter', ['--version']], ['dart', ['--version']], ['java', ['-version']], ['mvn', ['--version']], ['gradle', ['--version']], ['cmake', ['--version']], ['swift', ['--version']], ['godot', ['--version']]] as Array<[string, string[]]>) {
    if (comps.some((c) => toolRelevant(name, c.ecosystem))) tools[name] = toolVersion(name, args);
  }
  return { schemaVersion: 1, root, generatedAt: new Date().toISOString(), components: comps, tools, notes: comps.length ? [] : ['No recognizable project files were found.'] };
}

function toolRelevant(tool: string, eco: Ecosystem): boolean {
  const map: Record<string, Ecosystem[]> = { node: ['node'], python3: ['python'], cargo: ['rust'], go: ['go'], flutter: ['flutter'], dart: ['flutter'], java: ['java'], mvn: ['java'], gradle: ['java'], cmake: ['cpp'], swift: ['swift'], godot: ['godot'] };
  return map[tool]?.includes(eco) ?? false;
}
