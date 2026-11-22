import { describe, expect, it } from 'vitest';
import { validateScenarios } from '../../src/scenarios/validate.js';
import { generateScenarios } from '../../src/scenarios/generate.js';
import { configSchema } from '../../src/core/config.js';
import type { LiveDiscovery } from '../../src/discovery/types.js';

const good = {
  id: 'form-empty-submit', name: 'Submit form without required fields', category: 'form-validation', risk: 'low', target: '/register',
  steps: [{ action: 'goto', path: '/register' }, { action: 'submit', selector: 'form >> nth=0 >> button' }], expected: [{ type: 'noUncaughtExceptions' }], requiresApproval: false,
};

describe('validateScenarios', () => {
  it('accepts a well-formed scenario and the array/object wrappers', () => {
    expect(validateScenarios([good]).valid).toHaveLength(1);
    expect(validateScenarios({ scenarios: [good] }).valid).toHaveLength(1);
  });
  it('marks agent-supplied scenarios with origin=agent', () => {
    expect(validateScenarios([good], { forceOrigin: 'agent' }).valid[0]!.origin).toBe('agent');
  });
  it.each([
    ['unknown action (evaluate)', { ...good, steps: [{ action: 'evaluate', script: 'fetch("//evil")' }] }],
    ['shell action', { ...good, steps: [{ action: 'shell', command: 'rm -rf /' }] }],
    ['unknown expectation', { ...good, expected: [{ type: 'runThisJs', code: 'alert(1)' }] }],
    ['extra script field smuggled into a step', { ...good, steps: [{ action: 'click', selector: 'a', script: 'x' }].map((s) => ({ ...s })) }],
    ['off-origin target', { ...good, target: 'https://evil.com/' }],
    ['protocol-relative target', { ...good, target: '//evil.com/x' }],
    ['off-origin goto', { ...good, steps: [{ action: 'goto', path: 'http://evil.com' }] }],
    ['javascript: selector', { ...good, steps: [{ action: 'click', selector: 'javascript:alert(1)' }] }],
    ['bad id', { ...good, id: '../../etc/passwd' }],
    ['too many repeat clicks', { ...good, steps: [{ action: 'repeatClick', selector: 'button', times: 5000 }] }],
    ['huge fill', { ...good, steps: [{ action: 'fill', selector: 'input', value: 'A'.repeat(30000) }] }],
    ['bad category', { ...good, category: 'ddos' }],
    ['empty expectations', { ...good, expected: [] }],
    ['login outside authentication category', { ...good, steps: [{ action: 'login' }] }],
    ['invalid regex', { ...good, expected: [{ type: 'urlNotMatches', pattern: '(' }] }],
  ])('rejects: %s', (_n, bad) => {
    const r = validateScenarios([bad]);
    expect(r.valid).toHaveLength(0);
    expect(r.rejected).toHaveLength(1);
  });
  it('rejects duplicate ids but keeps the first', () => {
    const r = validateScenarios([good, good]);
    expect(r.valid).toHaveLength(1);
    expect(r.rejected[0]!.errors.join()).toMatch(/duplicate/);
  });
  it('rejects non-scenario input', () => {
    expect(validateScenarios('hello').rejected).toHaveLength(1);
    expect(validateScenarios(null).valid).toHaveLength(0);
  });
});

describe('generateScenarios (deterministic, no LLM)', () => {
  const live: LiveDiscovery = {
    origin: 'http://localhost:3000', truncated: false, skippedRoutes: [],
    pages: [
      { path: '/', status: 200, title: 'Home', forms: [], links: ['/notes'], apiCalls: [], loadErrors: [], buttons: [{ selector: ':is(button,[role=button]) >> nth=0', text: 'Show tip' }, { selector: ':is(button,[role=button]) >> nth=1', text: 'Delete my account' }] },
      {
        path: '/notes', status: 200, title: 'Notes', linkedFrom: '/', links: [], buttons: [], loadErrors: [], apiCalls: [{ method: 'GET', path: '/api/notes' }],
        forms: [{
          id: 'f0', selector: 'form >> nth=0', action: '', method: 'post', noValidate: false, hasConstraints: true, hasPassword: false, hasFile: false, text: 'Add note',
          fields: [{ index: 0, tag: 'input', type: 'text', name: 'title', id: '', required: true }, { index: 1, tag: 'input', type: 'email', name: 'email', id: '', required: true }],
          submit: { selector: 'form >> nth=0 >> button >> nth=0', text: 'Add note' },
        }],
      },
    ],
  };
  const scenarios = generateScenarios({ live, staticRoutes: ['/pricing', '/blog/[slug]'], config: configSchema.parse({}) });
  const byId = new Map(scenarios.map((s) => [s.id, s]));

  it('covers every category it is able to', () => {
    const cats = new Set(scenarios.map((s) => s.category));
    for (const c of ['navigation', 'form-validation', 'ui-chaos', 'network-failure']) expect(cats.has(c as never)).toBe(true);
  });
  it('produces only scenarios that pass validation', () => {
    const v = validateScenarios(scenarios);
    expect(v.rejected).toEqual([]);
    expect(v.valid).toHaveLength(scenarios.length);
  });
  it('generates the required form cases', () => {
    for (const id of ['empty-submit', 'invalid-email', 'long-text', 'special-chars', 'unicode-emoji', 'xss-marker', 'duplicate-submit']) expect(byId.has(`form-notes-f0-${id}`)).toBe(true);
    for (const m of ['http500', 'offline', 'http429', 'timeout']) expect(byId.has(`network-${m}-form-notes-f0`)).toBe(true);
  });
  it('flags destructive-looking buttons as requiring approval', () => {
    const del = scenarios.find((s) => s.name.includes('Delete my account'))!;
    expect(del).toMatchObject({ requiresApproval: true, sensitivity: 'deletion', risk: 'high' });
    expect(scenarios.find((s) => s.name.includes('Show tip'))!.requiresApproval).toBe(false);
  });
  it('treats statically-declared routes as soft (inferred) and skips dynamic ones', () => {
    const decl = byId.get('nav-declared-pricing')!;
    expect(decl.expected.find((e) => e.type === 'pageStatusOk')).toMatchObject({ hard: false });
    expect([...byId.keys()].some((k) => k.includes('slug'))).toBe(false);
  });
  it('keeps every category represented under a small cap', () => {
    const cfg = configSchema.parse({ maxTests: 8 });
    const s = generateScenarios({ live, staticRoutes: [], config: cfg });
    // generator returns everything ordered round-robin; the first 8 must span categories
    expect(new Set(s.slice(0, 8).map((x) => x.category)).size).toBeGreaterThanOrEqual(3);
  });
  it('never sends non-empty input to password forms', () => {
    const pw = structuredClone(live);
    pw.pages[1]!.forms[0]!.hasPassword = true;
    const s = generateScenarios({ live: pw, staticRoutes: [], config: configSchema.parse({}) });
    expect(s.filter((x) => x.id.startsWith('form-')).map((x) => x.id)).toEqual(['form-notes-f0-empty-submit']);
  });
});
