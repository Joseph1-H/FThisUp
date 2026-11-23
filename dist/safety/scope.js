import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isLoopbackHost } from './policy.js';
const cache = new Map();
const real = (p) => { try {
    return fs.realpathSync(p);
}
catch {
    return path.resolve(p);
} };
function run(cmd, args) {
    try {
        return spawnSync(cmd, args, { encoding: 'utf8', timeout: 2500 }).stdout ?? '';
    }
    catch {
        return '';
    }
}
/** Best effort: working directory of the process LISTENing on a local TCP port. null = unknown (Windows, no ss/lsof, no permission). */
export function portOwnerCwd(port) {
    if (cache.has(port))
        return cache.get(port);
    let cwd = null;
    try {
        let pid;
        if (process.platform === 'linux') {
            pid = /pid=(\d+)/.exec(run('ss', ['-H', '-ltnp', `sport = :${port}`]))?.[1];
            if (pid)
                cwd = real(`/proc/${pid}/cwd`);
        }
        if (!cwd && process.platform !== 'win32') {
            pid ??= /^p(\d+)/m.exec(run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp']))?.[1];
            if (pid && process.platform === 'darwin')
                cwd = /^n(.+)$/m.exec(run('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn']))?.[1] ?? null;
            else if (pid && !cwd)
                cwd = real(`/proc/${pid}/cwd`);
        }
    }
    catch {
        cwd = null;
    }
    cache.set(port, cwd);
    return cwd;
}
/** Is a server started from `ownerCwd` plausibly part of the project at `root`? */
export function ownerBelongsToProject(ownerCwd, root) {
    const o = real(ownerCwd), r = real(root);
    const inside = (a, b) => { const rel = path.relative(a, b); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
    if (inside(r, o))
        return true; // started from inside the project (or a subfolder)
    const home = real(os.homedir());
    // started from a parent (monorepo root): fine, but not from $HOME or the filesystem root
    return inside(o, r) && o !== home && o !== path.parse(o).root;
}
/** true only when the port's owner is KNOWN and belongs to a different project. */
export function isForeignPort(port, root) {
    if (!port)
        return false;
    const owner = portOwnerCwd(port);
    return owner !== null && !ownerBelongsToProject(owner, root);
}
export function foreignPortChecker(root) {
    return (port) => isForeignPort(port, root);
}
export function checkTargetOwnership(url, root) {
    let u;
    try {
        u = new URL(url);
    }
    catch {
        return { ok: true };
    }
    if (!isLoopbackHost(u.hostname))
        return { ok: true }; // ownership is about LOCAL ports; remote hosts are governed by the target policy
    const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
    const owner = portOwnerCwd(port);
    if (owner === null || ownerBelongsToProject(owner, root))
        return { ok: true };
    return { ok: false, reason: `the server on port ${port} was started from ${owner}, which is not part of this project (${root}).` };
}
