import fs from 'node:fs';
import path from 'node:path';
export function writeResultsJson(dir, results) {
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'results.json');
    fs.writeFileSync(f, JSON.stringify(results, null, 2), 'utf8');
    return f;
}
export function writeManifest(dir, manifest) {
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'discovery.json');
    fs.writeFileSync(f, JSON.stringify(manifest, null, 2), 'utf8');
    return f;
}
export function readResults(dir) {
    const f = path.join(dir, 'results.json');
    if (!fs.existsSync(f))
        throw new Error(`No results found at ${f}. Run \`fthisup test\` first.`);
    return JSON.parse(fs.readFileSync(f, 'utf8'));
}
export function writeJsonFile(dir, name, data) {
    if (!/^[\w.-]+\.json$/.test(name))
        throw new Error(`refusing to write unexpected artifact name ${name}`);
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, name);
    fs.writeFileSync(f, JSON.stringify(data, null, 2), 'utf8');
    return f;
}
