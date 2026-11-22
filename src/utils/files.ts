import fs from 'node:fs';
import path from 'node:path';

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', 'coverage',
  'fthisup-results', 'vendor', '.venv', 'venv', '__pycache__', '.idea', '.vscode', 'target', 'Pods', '.gradle', '.dart_tool',
]);
const SOURCE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte', '.astro', '.html', '.htm', '.py', '.dart']);
const MAX_FILE_BYTES = 300_000;

export function isEnvFile(name: string): boolean {
  return /^\.env($|\.)/i.test(name) || /\.(pem|key|p12|pfx)$/i.test(name) || /^(id_rsa|id_ed25519|credentials|secrets?)(\.|$)/i.test(name);
}

export interface SourceFile { rel: string; abs: string; text: string }

/** Walk source files. Never opens .env files, keys or credentials — they are skipped before any read. */
export function walkSources(root: string, opts: { maxFiles?: number } = {}): { files: SourceFile[]; truncated: boolean } {
  const maxFiles = opts.maxFiles ?? 3000;
  const files: SourceFile[] = [];
  let truncated = false;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (isEnvFile(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!IGNORED_DIRS.has(e.name) && !e.name.startsWith('.')) stack.push(abs);
        continue;
      }
      if (!e.isFile() || !SOURCE_EXT.has(path.extname(e.name).toLowerCase())) continue;
      if (files.length >= maxFiles) { truncated = true; return { files, truncated }; }
      try {
        const st = fs.statSync(abs);
        if (st.size > MAX_FILE_BYTES) continue;
        files.push({ rel: path.relative(root, abs).split(path.sep).join('/'), abs, text: fs.readFileSync(abs, 'utf8') });
      } catch { /* unreadable: skip */ }
    }
  }
  return { files, truncated };
}

export function readJsonSafe<T = Record<string, unknown>>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return null; }
}

export function lineOf(text: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}
