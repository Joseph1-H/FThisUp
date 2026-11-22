import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

function readVersion(): string {
  try {
    const p = fileURLToPath(new URL('../../package.json', import.meta.url));
    return (JSON.parse(fs.readFileSync(p, 'utf8')) as { version: string }).version;
  } catch { return '0.0.0'; }
}
export const VERSION = readVersion();
