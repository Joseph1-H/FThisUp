import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { headlineFor, renderReport } from '../../src/reporting/html.js';
import type { RunResults } from '../../src/core/types.js';
import { summarize } from '../../src/core/findings.js';
import { tmpDir } from '../helpers.js';

function results(over: Partial<RunResults['summary']> = {}, findings: RunResults['findings'] = []): RunResults {
  const summary = { ...summarize([], []), total: 5, passed: 5, ...over };
  return {
    schemaVersion: 1, tool: 'fthisup', project: 'demo', target: 'http://localhost:3000', mode: 'safe', startedAt: new Date().toISOString(), durationMs: 1234,
    environment: { fthisupVersion: '0.0.0', node: 'v22', platform: 'linux x64', browser: 'chromium', browserVersion: '1', headless: true },
    safety: { targetClass: 'loopback', environment: 'local', notes: [] }, summary, results: [], findings, coverage: { routesDiscovered: 1, routesTested: 1, formsDiscovered: 0, formsTested: 0, notes: [] },
  };
}

describe('report headline', () => {
  it('uses the "got fucked up" headline only with confirmed failures', () => {
    expect(headlineFor(results({ confirmed: 1, failed: 1, passed: 4 })).headline).toBe('FTHISUP — YOUR APP GOT FUCKED UP.');
    expect(headlineFor(results({ suspected: 2 })).headline).toBe('FTHISUP — NOTHING BROKE. YET.');
    expect(headlineFor(results()).headline).toBe('FTHISUP — NOTHING BROKE. YET.');
  });
  it('does not claim "nothing broke" when nothing ran, and never claims bug-free', () => {
    expect(headlineFor(results({ total: 0, passed: 0 })).headline).toBe('FTHISUP — NOTHING RAN.');
    expect(headlineFor(results()).sub).toMatch(/not prove/i);
  });
});

describe('renderReport', () => {
  it('is a self-contained document that cannot be broken out of by app-controlled text', () => {
    const evil = '</script><script>window.pwned=1</script><img src=x onerror=alert(1)>';
    const r = results({ confirmed: 1, failed: 1 }, [{
      id: 'F001', title: evil, category: 'ui-chaos', status: 'confirmed', severity: 'high', confidence: 'high', route: '/', expected: 'e', actual: evil,
      reproductionSteps: ['Open /'], reproduction: { attempted: true, attempts: 2, reproduced: true }, source: 'execution', suggestedFix: 'f',
      evidence: { consoleErrors: [{ type: 'error', text: evil }], pageErrors: [evil], networkFailures: [], mutatingRequests: [], blockedRequests: [], notes: [] },
    }]);
    const html = renderReport(r, tmpDir());
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html.match(/<script/g)!.length).toBe(2); // data + renderer only
    expect(html).not.toContain(evil);
    expect(html).not.toMatch(/<(link|script|img)[^>]+(src|href)=["']https?:/); // no remote assets: works offline
    const m = /<script type="application\/json" id="data">([\s\S]*?)<\/script>/.exec(html)!;
    expect(JSON.parse(m[1]!).results.findings[0].title).toBe(evil);
  });
  it('embeds screenshots as data URIs so it works offline', () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, 'screenshots'));
    fs.writeFileSync(path.join(dir, 'screenshots', 'a.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
    const r = results({ confirmed: 1 }, [{
      id: 'F001', title: 't', category: 'ui-chaos', status: 'confirmed', severity: 'low', confidence: 'high', route: '/', expected: 'e', actual: 'a', reproductionSteps: [], reproduction: { attempted: true, attempts: 2, reproduced: true },
      source: 'execution', suggestedFix: 'f', evidence: { consoleErrors: [], pageErrors: [], networkFailures: [], mutatingRequests: [], blockedRequests: [], notes: [], screenshot: 'screenshots/a.png' },
    }]);
    expect(renderReport(r, dir)).toContain('data:image/png;base64,iVBORw0KGgo=');
  });
});
