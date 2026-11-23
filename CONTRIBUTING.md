# Contributing to FThisUp

Thanks for helping. FThisUp's one rule: **never fake a result**. A check either executed against a real browser and measured something, or it is not reported as a finding.

## Setup

```bash
git clone <your fork>
cd fthisup
npm install
npx playwright install chromium     # Linux CI/containers: npx playwright install --with-deps chromium
npm run build
npm run check                       # typecheck + eslint + build + unit and end-to-end tests (~8 min)
```

Useful scripts: `npm run typecheck`, `npm run lint`, `npm run test:unit` (fast), `npm run test:e2e` (needs a fresh `npm run build`). Some end-to-end tests need real toolchains (cargo, flutter, cmake, python3, bubblewrap) and skip themselves with a reason when they are missing.

## Layout

| Path | What lives there |
|---|---|
| `src/cli` | Commander CLI + terminal UI |
| `src/adapters` | the adapter interface, registry and every adapter (web, api, cli, runners, desktop, godot, fuzz) + pure output parsers |
| `src/detect` | project/monorepo detection |
| `src/exec` | the ONLY place subprocesses are spawned: allow-list, sanitized env, limits, bubblewrap sandbox |
| `src/core` | config (zod), orchestrator, web runner, finding/status logic |
| `src/safety` | target policy, executor-level guard, sensitivity classifier, redaction |
| `src/discovery` | project scan (static) and live crawler |
| `src/scenarios` | typed schema, validator, deterministic generator |
| `src/engines/playwright` | session (request guard, fault injection), executor, expectation evaluators |
| `src/analysis` | static heuristics (warnings only) |
| `src/reporting` | JSON + self-contained HTML report |
| `skills/fthisup` | the Agent Skill shipped in the npm package |
| `tests/fixtures` | web fixture apps, plus `projects/` with a buggy AND a clean fixture for every adapter, and real captured tool output in `samples/` |

## Ground rules

- **Safety is enforced in code**, not in prompts or docs. Anything that sends traffic goes through `SafetyGuard` (`src/safety/policy.ts`); anything that runs a process goes through `runProcess` (`src/exec/run.ts`). Never call `child_process` directly from an adapter.
- **Scenarios are data.** Never add an action that evaluates strings as JavaScript or runs shell commands. New actions need a typed, bounded schema entry plus validator and unit tests.
- **New expectations must declare `hard` vs soft.** Hard = objectively measurable and safe to call *confirmed* after reproduction. Everything heuristic must stay soft (*suspected*).
- **No telemetry, no network calls to anything but the target, no required accounts or API keys.**
- Add a test for every behavior change. A new detector or adapter needs a fixture that triggers it **and** a clean fixture that must produce **zero** findings. Write result parsers against **real captured output** (`tests/fixtures/samples`), and label an adapter *experimental* if you could not verify it against the real toolchain.
- Never let an environment problem look like a bug (a CLI that cannot start, a missing tool, a harness failure) and never let a silent failure look like a clean pass.
- Keep dependencies minimal; justify any new runtime dependency in the PR.

## Pull requests

1. Open an issue first for large changes.
2. `npm test` must pass locally.
3. Describe what you ran and what you saw. Do not paste fabricated output.

## Adding an adapter

See [docs/adapters.md](docs/adapters.md#writing-a-new-adapter). React Native, Android/iOS UI automation and device integration tests are planned but **not implemented**; please do not merge stubs that claim support.
