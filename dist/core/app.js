import { spawn, spawnSync } from 'node:child_process';
import { probeUrl } from './runner.js';
/** Optional (--start): launches the user's own configured start command and waits for the URL. */
export async function startApp(command, cwd, url, timeoutMs = 90_000) {
    const win = process.platform === 'win32';
    const child = spawn(command, { cwd, shell: true, stdio: 'ignore', detached: !win });
    let exited = false;
    child.on('exit', () => { exited = true; });
    const stop = () => {
        if (exited || !child.pid)
            return;
        try {
            if (win)
                spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
            else
                process.kill(-child.pid, 'SIGTERM');
        }
        catch { /* already gone */ }
    };
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
        if (exited)
            throw new Error(`Start command "${command}" exited before ${url} became reachable.`);
        if ((await probeUrl(url, 1500)).ok)
            return { stop };
        await new Promise((r) => setTimeout(r, 750));
    }
    stop();
    throw new Error(`Timed out after ${timeoutMs / 1000}s waiting for ${url} (started with "${command}").`);
}
