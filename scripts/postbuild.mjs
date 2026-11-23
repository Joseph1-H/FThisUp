import fs from 'node:fs';
const f = 'dist/cli/index.js';
if (fs.existsSync(f)) {
  const s = fs.readFileSync(f, 'utf8');
  if (!s.startsWith('#!')) fs.writeFileSync(f, `#!/usr/bin/env node\n${s}`);
  try { fs.chmodSync(f, 0o755); } catch { /* windows */ }
}

// non-TypeScript assets that must ship with dist/
if (fs.existsSync('src/adapters/harness')) fs.cpSync('src/adapters/harness', 'dist/adapters/harness', { recursive: true });
