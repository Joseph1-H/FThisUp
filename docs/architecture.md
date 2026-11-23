# Architecture

```
CLI ──► orchestrator ──► detectProjectManifest  (components: ecosystem, roles, frameworks, test commands + availability)
              │
              ├─ resolveTarget (--url > config url > a local server owned by THIS project)
              ├─ for each registered adapter:  detect ► capabilities ► plan        (nothing executes yet)
              │      web · api · cli · python · javascript · flutter · rust · go · java · cpp · swift · desktop · godot
              ├─ execute: bounded concurrency (2), "network" adapters serialized, opt-in/"exclusive" adapters last
              │      web      ► runTests  (Playwright, SafetyGuard on every request)
              │      api      ► fetch through SafetyGuard (rate limit, budget, approvals)
              │      cli/fuzz ► runProcess (allow-list, sanitized env, limits, bubblewrap sandbox)
              │      runners  ► runProcess + pure output parsers (TAP, JUnit, cargo, go -json, dart json, ctest, ...)
              ├─ reproduce every failure once in a fresh context/process  → confirmed | suspected | not-reproducible
              ├─ static-analysis warnings (heuristic, never counted as executed tests)
              └─ aggregate ► results.json (redacted) · project.json · discovery.json · report.html
```

## Layers

| Layer | Path | Responsibility |
|---|---|---|
| Detection | `src/detect` | One component per ecosystem/directory (monorepos), roles, frameworks, tests, tool availability |
| Adapter contract | `src/adapters/types.ts` | `detect / capabilities / plan / execute`, requirements, categories, safety statements, resource group |
| Adapters | `src/adapters/*.ts` | web, api, cli, runners (python/javascript/rust/go/flutter/java/cpp/swift), desktop, godot, fuzz |
| Parsers | `src/adapters/parsers.ts` | Pure functions over tool output; tested against **real captured output** |
| Execution safety | `src/exec` | allow-list, env sanitation, timeouts, limits, bubblewrap |
| Network safety | `src/safety` | target policy, per-request guard, approvals, redaction, project scope |
| Scenarios | `src/scenarios` | Strict typed schemas (web, CLI, API); deterministic generators |
| Orchestration | `src/core` | selection, scheduling, aggregation, finding/status logic |
| Reporting | `src/reporting` | `results.json`, self-contained `report.html` |

## Statuses

- **confirmed**: failed *and* reproduced on a fresh re-run *and* at least one reproduced failing check is **hard** (objectively measurable: uncaught exception, crash, hang on trivial input, HTTP 5xx on a valid request, accepted invalid input where the spec says required, protected content/endpoint reachable without credentials, duplicate requests, failed build, missing referenced file...).
- **suspected**: reproduced but only heuristic checks failed, or reproduction was not possible/safe, or a static-analysis warning, or a timeout that could be a legitimately long-running program.
- **not-reproducible**: failed once, passed on re-run.
- **skipped**: could not be evaluated (element missing, no credentials, tool missing...). Never reported as a bug.
- **blocked**: stopped by the safety policy (sensitive action, read-only target, sandbox required...).

A failing **existing test** is `confirmed` as a *failure* (it reproduces) but carries `evidenceKind: failed-assertion`: it may mean the code regressed or the test is outdated.

## Deterministic first, agents second

Every adapter generates its adversarial cases deterministically (no LLM). Agents can add typed scenarios (`--scenarios`), which are validated against strict schemas before anything runs and execute under the same runtime guards.

## Adding an adapter

See [adapters.md](adapters.md#writing-a-new-adapter).
