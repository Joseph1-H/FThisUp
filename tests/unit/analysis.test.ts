import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeStatic } from '../../src/analysis/static.js';
import { discoverProject } from '../../src/discovery/project.js';
import { walkSources } from '../../src/utils/files.js';
import { ROOT } from '../helpers.js';

const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'static-project');

describe('static analysis', () => {
  const { findings } = analyzeStatic(FIXTURE);
  const titles = findings.map((f) => f.title).join('\n');
  it('flags the planted heuristics', () => {
    expect(titles).toMatch(/Placeholder implementation/);
    expect(titles).toMatch(/Hard-coded mock data/);
    expect(titles).toMatch(/Empty event handler/);
    expect(titles).toMatch(/TODO\/FIXME in a critical path/);
    expect(titles).toMatch(/Silently swallowed error/);
    expect(titles).toMatch(/Placeholder API configuration/);
    expect(titles).toMatch(/Button without an apparent action/);
    expect(titles).toMatch(/neverCalledHelper/);
  });
  it('only ever reports heuristics as unconfirmed suspicions', () => {
    for (const f of findings) {
      expect(f.status).toBe('suspected');
      expect(f.source).toBe('static-analysis');
      expect(f.confidence).toBe('low');
      expect(f.actual).toMatch(/NOT confirmed|heuristic/i);
    }
  });
  it('never reads .env files', () => {
    const { files } = walkSources(FIXTURE);
    expect(files.some((f) => /\.env/.test(f.rel))).toBe(false);
    expect(JSON.stringify(findings)).not.toContain('do-not-read-me');
  });
});

describe('project discovery', () => {
  const d = discoverProject(FIXTURE);
  it('marks manifest-derived facts confirmed', () => {
    expect(d.framework).toMatchObject({ value: 'Next.js', certainty: 'confirmed' });
    expect(d.testFrameworks.map((t) => t.value)).toContain('vitest');
    expect(d.testFrameworks.every((t) => t.certainty === 'confirmed')).toBe(true);
    expect(d.startCommands[0]).toMatchObject({ value: 'npm run dev', certainty: 'confirmed' });
    expect(d.likelyPort).toMatchObject({ value: 3456, certainty: 'confirmed' });
    expect(d.language[0]).toMatchObject({ value: 'TypeScript', certainty: 'confirmed' });
  });
  it('marks pattern-derived facts inferred', () => {
    expect(d.routes.map((r) => r.value)).toEqual(expect.arrayContaining(['/', '/pricing']));
    expect(d.routes.every((r) => r.certainty === 'inferred')).toBe(true);
    expect(d.forms.length).toBeGreaterThan(0);
    expect(d.forms.every((f) => f.certainty === 'inferred')).toBe(true);
    expect(d.authSignals.some((a) => a.value.includes('next-auth') && a.certainty === 'confirmed')).toBe(true);
    expect(d.apiIntegrations.some((a) => a.value.includes('axios'))).toBe(true);
  });
});

describe('skill packaging', () => {
  it('repo-root SKILL.md and references mirror skills/fthisup (so a plain git clone is a valid skill)', async () => {
    const fs = await import('node:fs');
    const rd = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
    expect(rd('SKILL.md')).toBe(rd('skills/fthisup/SKILL.md'));
    for (const f of ['fix.md', 'scenario-format.md']) expect(rd(`references/${f}`)).toBe(rd(`skills/fthisup/references/${f}`));
    expect(rd('SKILL.md')).toMatch(/^---\nname: fthisup\n/);
  });
});
