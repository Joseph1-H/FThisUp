import fs from 'node:fs';
const f = 'dist/cli/index.js';
if (fs.existsSync(f)) {
  const s = fs.readFileSync(f, 'utf8');
  if (!s.startsWith('#!')) fs.writeFileSync(f, `#!/usr/bin/env node\n${s}`);
  try { fs.chmodSync(f, 0o755); } catch { /* windows */ }
}
