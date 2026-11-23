import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const whichCache = new Map();
const versionCache = new Map();
/** Locate an executable on PATH (no shell). */
export function which(exe) {
    if (whichCache.has(exe))
        return whichCache.get(exe);
    let found = null;
    if (path.isAbsolute(exe))
        found = fs.existsSync(exe) ? exe : null;
    else {
        const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
        outer: for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
            if (!dir)
                continue;
            for (const ext of exts) {
                const p = path.join(dir, exe + ext);
                try {
                    if (fs.statSync(p).isFile()) {
                        fs.accessSync(p, fs.constants.X_OK);
                        found = p;
                        break outer;
                    }
                }
                catch { /* keep looking */ }
            }
        }
    }
    whichCache.set(exe, found);
    return found;
}
/** First line of `exe --version`, or null if it cannot run. Bounded to 8s. */
export function toolVersion(exe, args = ['--version']) {
    const key = `${exe} ${args.join(' ')}`;
    if (versionCache.has(key))
        return versionCache.get(key);
    let v = null;
    const p = which(exe);
    if (p) {
        try {
            const r = spawnSync(p, args, { encoding: 'utf8', timeout: 8000, env: { ...process.env, CI: '1' } });
            if (r.status === 0 || r.stdout || r.stderr)
                v = ((r.stdout || r.stderr) ?? '').split('\n').find((l) => l.trim())?.trim().slice(0, 120) ?? null;
        }
        catch {
            v = null;
        }
    }
    versionCache.set(key, v);
    return v;
}
export function pythonExe() {
    for (const c of ['python3', 'python'])
        if (which(c))
            return c;
    return null;
}
/** Can `python -c "import <mod>"` succeed? (never installs anything) */
const pyMods = new Map();
export function pythonHasModule(mod, cwd) {
    const key = `${cwd ?? ''}:${mod}`;
    if (pyMods.has(key))
        return pyMods.get(key);
    const py = pythonExe();
    let ok = false;
    if (py) {
        const r = spawnSync(which(py), ['-c', `import importlib.util,sys;sys.exit(0 if importlib.util.find_spec(${JSON.stringify(mod)}) else 1)`], { cwd, timeout: 8000 });
        ok = r.status === 0;
    }
    pyMods.set(key, ok);
    return ok;
}
