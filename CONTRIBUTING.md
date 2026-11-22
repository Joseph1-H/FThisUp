# Contributing to FThisUp

Thanks for helping. FThisUp's one rule: **never fake a result**. A check either executed against a real browser and measured something, or it is not reported as a finding.

## Setup

```bash
git clone <your fork>
cd fthisup
npm install
npx playwright install chromium     # Linux CI/containers: npx playwright install --with-deps chromium
npm run build
npm test                            # builds, then runs unit + end-to-end tests (~3-4 min)
```

Useful scripts: `npm run typecheck`, `npm run test:unit` (fast, no browser), `npm run test:e2e` (needs a fresh `npm run build`).

## Layout

| Path | What lives there |
|---|---|
| `src/cli` | Commander CLI + terminal UI |
| `src/core` | config (zod), runner, finding/status logic |
| `src/safety` | target policy, executor-level guard, sensitivity classifier, redaction |
| `src/discovery` | project scan (static) and live crawler |
| `src/scenarios` | typed schema, validator, deterministic generator |
| `src/engines/playwright` | session (request guard, fault injection), executor, expectation evaluators |
| `src/analysis` | static heuristics (warnings only) |
| `src/reporting` | JSON + self-contained HTML report |
| `skills/fthisup` | the Agent Skill shipped in the npm package |
| `tests/fixtures` | intentionally buggy app, clean app, auth app, static project |

## Ground rules

- **Safety is enforced in code** (`src/safety/policy.ts`, `executeScenario`), not in prompts or docs. Any new capability that sends traffic must go through `SafetyGuard`.
- **Scenarios are data.** Never add an action that evaluates strings as JavaScript or runs shell commands. New actions need a typed, bounded schema entry plus validator and unit tests.
- **New expectations must declare `hard` vs soft.** Hard = objectively measurable and safe to call *confirmed* after reproduction. Everything heuristic must stay soft (*suspected*).
- **No telemetry, no network calls to anything but the target, no required accounts or API keys.**
- Add a test for every behavior change. A new detector needs a fixture that triggers it **and** a check that the clean fixture does not.
- Keep dependencies minimal; justify any new runtime dependency in the PR.

## Pull requests

1. Open an issue first for large changes.
2. `npm test` must pass locally.
3. Describe what you ran and what you saw. Do not paste fabricated output.

## Adding a platform engine (future)

Engines live under `src/engines/<name>/` and must implement session creation, step execution and expectation evaluation behind the same `Scenario` schema and `SafetyGuard`. Flutter, React Native, Android and iOS are planned but **not implemented**; please do not merge stubs that claim support.
