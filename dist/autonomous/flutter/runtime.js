import { runProcess } from '../../exec/run.js';
import { which } from '../../exec/tools.js';
/** Which devices could run integration tests? Only LISTS what already exists: never starts an emulator or changes device config. */
export async function detectFlutterRuntime(compDir, root) {
    if (!which('flutter'))
        return { flutter: false, devices: [], mobile: false, note: 'Flutter SDK not found on PATH.' };
    const r = await runProcess({ file: 'flutter', args: ['devices', '--machine'], cwd: compDir, projectRoot: root, timeoutMs: 45_000, limits: false });
    const m = /\[[\s\S]*\]/.exec(r.stdout);
    if (!m)
        return { flutter: true, devices: [], mobile: false, note: r.timedOut ? 'flutter devices timed out.' : 'flutter devices produced no device list.' };
    try {
        const raw = JSON.parse(m[0]);
        const devices = raw.map((d) => ({ id: d.id, name: d.name, platform: d.targetPlatform ?? 'unknown', emulator: !!d.emulator }));
        const mobile = devices.some((d) => /^(android|ios)/.test(d.platform));
        return { flutter: true, devices, mobile, note: mobile ? 'An Android/iOS device or emulator is already running. FThisUp lists it but does not drive it (on-device generated tests are not implemented).' : 'No running Android/iOS device or emulator. FThisUp never starts one; runtime UI tests were not run.' };
    }
    catch {
        return { flutter: true, devices: [], mobile: false, note: 'could not parse flutter devices output.' };
    }
}
