/** Pure parsers for the output of existing test runners. Each returns individual test outcomes; no I/O here. */
const cap = (s, n = 900) => (s.length > n ? `${s.slice(0, n)}…` : s);
// ------------------------------------------------------------------ node:test (TAP)
export function parseTap(out) {
    const lines = out.split('\n');
    const entries = [];
    let summarySeen = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^# (pass|tests) \d+/.test(line))
            summarySeen = true;
        const m = /^(\s*)(not )?ok \d+ - (.*?)(?:\s+# (SKIP|TODO)\b.*)?$/.exec(line);
        if (!m)
            continue;
        const indent = m[1].length;
        const block = [];
        if (/^\s*---\s*$/.test(lines[i + 1] ?? '')) {
            for (let k = i + 2; k < lines.length && !/^\s*\.\.\.\s*$/.test(lines[k]); k++)
                block.push(lines[k]);
        }
        // mark as a suite if deeper entries directly precede it
        const hasChildren = entries.length > 0 && entries[entries.length - 1].indent > indent;
        entries.push({ indent, ok: !m[2], name: m[3], skip: m[4] === 'SKIP', todo: m[4] === 'TODO', block, suite: hasChildren, idx: i });
    }
    const tests = [];
    for (const e of entries) {
        if (e.suite)
            continue;
        const dur = /duration_ms:\s*([\d.]+)/.exec(e.block.join('\n'))?.[1];
        let message;
        if (!e.ok) {
            const i = e.block.findIndex((l) => /^\s*error:/.test(l));
            if (i >= 0) {
                const first = e.block[i].replace(/^\s*error:\s*/, '');
                if (/^[|>]-?$/.test(first.trim())) {
                    const body = [];
                    for (let k = i + 1; k < e.block.length && /^\s{4,}/.test(e.block[k]); k++)
                        body.push(e.block[k].trim());
                    message = body.filter(Boolean).join(' ');
                }
                else
                    message = first.replace(/^'|'$/g, '');
            }
            const loc = /location:\s*'([^']+)'/.exec(e.block.join('\n'))?.[1];
            message = cap(`${message ?? 'test failed'}${loc ? ` (${loc})` : ''}`);
        }
        tests.push({ name: e.name, status: e.skip || e.todo ? 'skipped' : e.ok ? 'passed' : 'failed', message, durationMs: dur ? Number(dur) : undefined });
    }
    return { tests, summarySeen };
}
// ------------------------------------------------------------------ python unittest (-v)
export function parseUnittest(out) {
    const tests = [];
    const details = new Map();
    const detailRe = /^={10,}\n(FAIL|ERROR): (.+?) \((.+?)\)\n-{10,}\n([\s\S]*?)(?=\n={10,}\n|\n-{10,}\nRan \d+ test)/gm;
    for (let m; (m = detailRe.exec(out));)
        details.set(m[3], m[4].trim());
    const re = /^(\S+) \(([\w.]+)\)(?:\n[^\n]*?)? \.\.\. (ok|FAIL|ERROR|skipped(?: '.*')?|expected failure|unexpected success)\s*$/gm;
    for (let m; (m = re.exec(out));) {
        const [, name, id, res] = m;
        const d = details.get(id);
        const last = d?.split('\n').filter((l) => l.trim()).pop();
        tests.push({
            name: id.includes('.') ? id : `${name}`,
            status: res === 'ok' || res === 'expected failure' ? 'passed' : res.startsWith('skipped') ? 'skipped' : res === 'FAIL' || res === 'unexpected success' ? 'failed' : 'errored',
            message: res === 'ok' ? undefined : cap(last ?? res),
        });
    }
    // import errors show up as ERROR: test_module (unittest.loader._FailedTest.test_module)
    for (const [id, d] of details)
        if (/_FailedTest/.test(id) && !tests.some((t) => t.name === id))
            tests.push({ name: id, status: 'errored', message: cap(d.split('\n').filter((l) => l.trim()).pop() ?? 'import error') });
    return { tests, summarySeen: /^Ran \d+ tests? in/m.test(out) };
}
// ------------------------------------------------------------------ JUnit XML (pytest --junitxml, Maven surefire, Gradle)
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
export function parseJUnit(xml) {
    const tests = [];
    const re = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
    const attr = (a, n) => { const m = new RegExp(`\\b${n}="([^"]*)"`).exec(a); return m ? unesc(m[1]) : undefined; };
    for (let m; (m = re.exec(xml));) {
        const a = m[1], body = m[2] ?? '';
        const name = [attr(a, 'classname'), attr(a, 'name')].filter(Boolean).join('::');
        const t = attr(a, 'time');
        const f = /<(failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/.exec(body);
        const sk = /<skipped\b([^>]*?)(?:\/>|>)/.exec(body);
        tests.push({
            name, durationMs: t ? Math.round(Number(t) * 1000) : undefined, file: attr(a, 'file'),
            status: f ? (f[1] === 'failure' ? 'failed' : 'errored') : sk ? 'skipped' : 'passed',
            message: f ? cap(unesc(attr(f[2], 'message') ?? f[3] ?? 'failed').split('\n').slice(0, 6).join('\n')) : undefined,
        });
    }
    return { tests, summarySeen: /<testsuite/.test(xml) };
}
// ------------------------------------------------------------------ cargo test
export function parseCargo(out) {
    const tests = [];
    const msgs = new Map();
    const detail = /^---- (\S+) stdout ----\n([\s\S]*?)(?=\n---- |\nfailures:\n|\ntest result:)/gm;
    for (let m; (m = detail.exec(out));)
        msgs.set(m[1], m[2].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('note: run with')).join(' | '));
    const re = /^test (\S+) \.\.\. (ok|FAILED|ignored)(?:, (.*))?$/gm;
    for (let m; (m = re.exec(out));) {
        tests.push({ name: m[1], status: m[2] === 'ok' ? 'passed' : m[2] === 'ignored' ? 'skipped' : 'failed', message: m[2] === 'FAILED' ? cap(msgs.get(m[1]) ?? 'test failed') : undefined });
    }
    return { tests, summarySeen: /^test result:/m.test(out) };
}
/** Build/dependency failures that happen before any test runs (all runners). */
export function classifyBuildFailure(out) {
    if (/ModuleNotFoundError|No module named|Cannot find module|ERR_MODULE_NOT_FOUND|could not find (crate|package)|no matching package|Could not resolve dependenc|dependencies are not installed|Failed to resolve|pub get failed|package .* not found|unable to find package|Could not find artifact|failed to download/i.test(out))
        return 'dependency-failure';
    if (/error\[E\d+\]|error: could not compile|\bSyntaxError\b|IndentationError|\[build failed\]|cannot find symbol|COMPILATION ERROR|error: .*undefined reference|make.*\*\*\*.*Error|CMake Error|Compilation failed|Failed to compile|error TS\d+|Error: Command failed|BUILD FAILED|FAILURE: Build failed/i.test(out))
        return 'build-failure';
    return null;
}
// ------------------------------------------------------------------ go test -json
export function parseGoJson(out) {
    const tests = [];
    const outputs = new Map();
    const pkgOutputs = new Map();
    const finished = new Set();
    let summarySeen = false;
    for (const line of out.split('\n')) {
        if (!line.startsWith('{'))
            continue;
        let e;
        try {
            e = JSON.parse(line);
        }
        catch {
            continue;
        }
        const key = `${e.Package ?? ''}${e.Test ? `/${e.Test}` : ''}`;
        if (e.Action === 'output' && e.Output) {
            const m = e.Test ? outputs : pkgOutputs;
            const a = m.get(key) ?? [];
            a.push(e.Output.trimEnd());
            m.set(key, a);
        }
        if (!e.Test && (e.Action === 'pass' || e.Action === 'fail' || e.Action === 'skip'))
            summarySeen = true;
        if (e.Test && (e.Action === 'pass' || e.Action === 'fail' || e.Action === 'skip') && !finished.has(key)) {
            finished.add(key);
            const msg = (outputs.get(key) ?? []).filter((l) => !/^(=== |--- |PASS|FAIL|\s*$)/.test(l)).join(' | ');
            tests.push({ name: key, status: e.Action === 'pass' ? 'passed' : e.Action === 'skip' ? 'skipped' : 'failed', durationMs: e.Elapsed !== undefined ? Math.round(e.Elapsed * 1000) : undefined, message: e.Action === 'fail' ? cap(msg || 'test failed') : undefined });
        }
    }
    // a package-level FAIL with no failing test usually means a build/vet failure
    for (const [key, lines] of pkgOutputs) {
        if (tests.some((t) => t.name.startsWith(`${key}/`)))
            continue;
        if (lines.some((l) => /\[build failed\]|\[setup failed\]/.test(l)))
            tests.push({ name: key, status: 'errored', message: cap(lines.filter((l) => !/^(FAIL|ok)\b/.test(l)).join(' | ')) });
    }
    return { tests, summarySeen };
}
// ------------------------------------------------------------------ flutter test / dart test (--reporter json)
export function parseDartJson(out) {
    const names = new Map();
    const errors = new Map();
    const tests = [];
    let summarySeen = false;
    for (const line of out.split('\n')) {
        if (!line.startsWith('{'))
            continue;
        let e;
        try {
            e = JSON.parse(line);
        }
        catch {
            continue;
        }
        if (e.type === 'testStart')
            names.set(e.test.id, { name: e.test.name, hidden: false });
        else if (e.type === 'error') {
            const a = errors.get(e.testID) ?? [];
            a.push(`${String(e.error).trim()}`);
            errors.set(e.testID, a);
        }
        else if (e.type === 'testDone') {
            const t = names.get(e.testID);
            if (!t || e.hidden || /^loading /.test(t.name) || /^(setUp|tearDown)/.test(t.name))
                continue;
            const msg = errors.get(e.testID)?.join(' | ');
            tests.push({ name: t.name, status: e.skipped ? 'skipped' : e.result === 'success' ? 'passed' : e.result === 'failure' ? 'failed' : 'errored', message: msg ? cap(msg.replace(/\s+/g, ' ')) : undefined });
        }
        else if (e.type === 'done')
            summarySeen = true;
    }
    // suites that failed to load (compile errors) appear as hidden "loading ..." failures
    for (const [id, t] of names)
        if (/^loading /.test(t.name) && errors.has(id))
            tests.push({ name: t.name, status: 'errored', message: cap(errors.get(id).join(' | ').replace(/\s+/g, ' ')) });
    return { tests, summarySeen };
}
// ------------------------------------------------------------------ ctest
export function parseCtest(out) {
    const tests = [];
    const re = /^\s*\d+\/\d+ Test\s+#\d+: (\S+) \.+\s*(Passed|\*\*\*Failed|\*\*\*Exception: ?\w*|\*\*\*Timeout|\*\*\*Not Run|Not Run|\*\*\*Skipped|\*\*\*SEGFAULT)\s+([\d.]+) sec\s*\n?((?:(?!^\s*\d+\/\d+ Test|^\s*Start |\n\d+% tests passed)[^\n]*\n?)*)/gm;
    for (let m; (m = re.exec(out));) {
        const res = m[2];
        const body = (m[4] ?? '').trim().replace(/\n+/g, ' | ');
        tests.push({
            name: m[1], durationMs: Math.round(Number(m[3]) * 1000),
            status: res === 'Passed' ? 'passed' : /Not Run|Skipped/.test(res) ? 'skipped' : /Exception|SEGFAULT|Timeout/.test(res) ? 'errored' : 'failed',
            message: res === 'Passed' ? undefined : cap(`${res.replace(/\*+/g, '')}${body ? `: ${body}` : ''}`),
        });
    }
    return { tests, summarySeen: /tests passed, \d+ tests failed out of/.test(out) };
}
// ------------------------------------------------------------------ swift test
export function parseSwift(out) {
    const tests = [];
    const seen = new Set();
    for (const m of out.matchAll(/Test Case '(.+?)' (passed|failed)/g)) {
        if (seen.has(m[1]))
            continue;
        seen.add(m[1]);
        tests.push({ name: m[1], status: m[2] === 'passed' ? 'passed' : 'failed', message: m[2] === 'failed' ? cap(out.split('\n').filter((l) => l.includes('error:') && l.includes(m[1].split(/[ .]/).pop() ?? '')).slice(0, 2).join(' | ') || 'test failed') : undefined });
    }
    for (const m of out.matchAll(/^[✔✘] Test "?(.+?)"? (passed|failed)/gm))
        if (!seen.has(m[1])) {
            seen.add(m[1]);
            tests.push({ name: m[1], status: m[2] === 'passed' ? 'passed' : 'failed' });
        }
    return { tests, summarySeen: /Executed \d+ tests?|Test run with \d+ tests?/.test(out) };
}
// ------------------------------------------------------------------ jest / vitest JSON (--json / --reporter=json)
export function parseJestJson(json) {
    let j;
    try {
        j = JSON.parse(json);
    }
    catch {
        return { tests: [], summarySeen: false };
    }
    const tests = [];
    for (const f of j.testResults ?? []) {
        if (!f.assertionResults?.length && f.message)
            tests.push({ name: f.name ?? 'test file', status: 'errored', message: cap(f.message.replace(/\s+/g, ' ')), file: f.name });
        for (const a of f.assertionResults ?? []) {
            tests.push({
                name: a.fullName ?? a.title ?? 'test', file: f.name, durationMs: a.duration !== undefined && a.duration !== null ? Math.round(a.duration) : undefined,
                status: a.status === 'passed' ? 'passed' : a.status === 'failed' ? 'failed' : 'skipped',
                message: a.status === 'failed' ? cap((a.failureMessages ?? []).join(' ').replace(/\u001b\[[\d;]*m/g, '').replace(/\s+/g, ' ')) : undefined,
            });
        }
    }
    return { tests, summarySeen: true };
}
export function parseDartAnalyze(out) {
    const errors = [];
    let warnings = 0, infos = 0;
    for (const l of out.split('\n')) {
        const m = /^\s*(error|warning|info) [•-] (.+)$/.exec(l);
        if (!m)
            continue;
        if (m[1] === 'error')
            errors.push(m[2].trim());
        else if (m[1] === 'warning')
            warnings++;
        else
            infos++;
    }
    return { errors, warnings, infos };
}
export function parseTsc(out) {
    const errors = out.split('\n').filter((l) => /\berror TS\d+:/.test(l)).map((l) => l.trim());
    return { errors, warnings: 0, infos: 0 };
}
export function parseCargoDiag(out) {
    const errors = out.split('\n').filter((l) => /^error(\[E\d+\])?:/.test(l) && !/could not compile|aborting due to/.test(l));
    const warnings = (out.match(/^warning:/gm) ?? []).length;
    return { errors, warnings, infos: 0 };
}
export function parseGoVet(out) {
    const errors = out.split('\n').filter((l) => /^\S+\.go:\d+:\d+:/.test(l));
    return { errors, warnings: 0, infos: 0 };
}
