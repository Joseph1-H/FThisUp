import fs from 'node:fs';
import path from 'node:path';
import type { RunResults } from '../core/types.js';
import type { Manifest } from '../discovery/types.js';

export function writeResultsJson(dir: string, results: RunResults): string {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'results.json');
  fs.writeFileSync(f, JSON.stringify(results, null, 2), 'utf8');
  return f;
}
export function writeManifest(dir: string, manifest: Manifest): string {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'discovery.json');
  fs.writeFileSync(f, JSON.stringify(manifest, null, 2), 'utf8');
  return f;
}
export function readResults(dir: string): RunResults {
  const f = path.join(dir, 'results.json');
  if (!fs.existsSync(f)) throw new Error(`No results found at ${f}. Run \`fthisup test\` first.`);
  return JSON.parse(fs.readFileSync(f, 'utf8')) as RunResults;
}
