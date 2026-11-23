import { discoverProject } from '../discovery/project.js';
import { foreignPortChecker } from '../safety/scope.js';
import { detectLocalUrl } from '../utils/ports.js';
/** CLI flag > config "url" > a local server found on a common loopback port that belongs to THIS project. */
export async function resolveTarget(root, config, explicit) {
    if (explicit)
        return { url: explicit, source: 'cli' };
    if (config.url)
        return { url: config.url, source: 'config' };
    const project = discoverProject(root);
    const foreign = foreignPortChecker(root);
    const url = await detectLocalUrl(project.likelyPort?.value, (port) => !foreign(port));
    return url ? { url, source: 'auto' } : { url: null, source: 'none' };
}
