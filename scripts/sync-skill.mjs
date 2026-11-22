// Keeps the repo-root SKILL.md (+ references/) identical to skills/fthisup, so that
// `git clone <repo> ~/.claude/skills/fthisup` yields a valid skill directory.
import fs from 'node:fs';
fs.copyFileSync('skills/fthisup/SKILL.md', 'SKILL.md');
fs.rmSync('references', { recursive: true, force: true });
fs.cpSync('skills/fthisup/references', 'references', { recursive: true });
