# Autonomous discovery (v0.3)

Existing tests only prove what the developer already thought of. Autonomous discovery writes **new, project-specific** adversarial tests, runs them in isolation, re-runs every failure, and reports only what is supported by evidence.

```
Project discovery ─ fthisup discover (app-map.json: screens, fields, actions, handlers, persistence, coverage gaps, risk score)
   ↓
Behaviour analysis + risk identification ─ the host agent reads the map, the riskiest source, docs and tests
   ↓
Scenario generation ─ agent writes fthisup-scenarios/flutter.json (typed data, no code) · engine adds seeded invariant scenarios
   ↓
Scenario validation ─ strict schema · widgets/keys/args must exist · references and quotes verified · budgets
   ↓
Test construction ─ engine turns typed scenarios into Dart widget tests (only escaped literals reach the source)
   ↓
Isolated execution ─ temporary copy of the project · network blocked · deleted afterwards · project hash verified
   ↓
Failure reproduction ─ every failure re-run in fresh processes (default 2×) · must fail the same way every time
   ↓
Classification ─ passed · confirmed · suspected · not-reproducible · invalid test · environment limit · rejected · skipped
   ↓
Report ─ existing tests / generated tests / static analysis shown separately; new findings badged NEW
```

## Agent ⇄ engine exchange
There is no hidden LLM dependency. The host agent (Claude Code, Codex, Cursor, …) supplies scenarios as **files**: `fthisup discover` writes `fthisup-results/app-map.json`; the agent writes `fthisup-scenarios/flutter.json` ([format](../skills/fthisup/references/discovery-format.md)); `fthisup test --discovery` validates and executes them. Without an agent, `--discovery` still runs engine-seeded scenarios based on universal invariants (no uncaught exception, no layout overflow, no use-after-dispose).

```bash
fthisup discover [--example] [--runtime] [--print]
fthisup test --discovery [--mode thorough] [--dry-run]
```
`--dry-run --discovery` validates everything and prints counts; nothing is executed.

## When is a failure a confirmed bug?
All of: the test is valid (target exists, screen builds before any interaction, no environment error) · it failed on the first run · it failed **identically on every independent re-run** · the failure came from an observed exception/assertion record · the expectation is an **invariant** or a **documented/code/test requirement whose file and verbatim quote were verified**. An `assumption` (or an unverifiable reference) caps the result at *suspected*. A wrong test is *invalid*; a missing backend/provider/plugin is an *environment limit*; neither is ever a bug.

## What is supported today
| Ecosystem | Autonomous discovery | Notes |
|---|---|---|
| Flutter apps | **implemented and verified** | app map, typed widget-test generation, isolated execution, reproduction. Widget tests only. |
| Web / API / CLI | typed agent scenarios via `--scenarios` run in a real browser / HTTP / sandbox and are tagged *generated*; **no engine-side app map or seeding yet** | |
| Python / JavaScript | bounded function fuzzing (engine-generated edge values); **agent-written property tests are not implemented** | |
| Other languages | existing tests and analyzers only | |
| Flutter on a device/emulator | **not implemented**: `fthisup discover --runtime` only *lists* devices that are already running; nothing is launched or driven | |

## Isolation and safety
- Source files are only ever read. A hash of the project is compared before and after; a change is reported as a warning.
- Tests run in a temporary copy (platform folders and your own `test/` excluded), packages resolved with `flutter pub get --offline`, deleted afterwards (also on SIGINT/SIGTERM).
- Generated tests set `HttpOverrides` so any network use throws; attempted hosts are recorded. They run with a sanitized environment (no API keys/tokens), so they can never reach a Supabase project. Code paths that need a backend are reported as environment limits.
- No OS sandbox is applied to Flutter runs (the SDK needs a writable cache), so your app's code runs with this user's normal permissions, as when you run your own tests. The scenario format cannot express shell commands, code or URLs.

## Budgets (`discovery` in fthisup.config.json)
`maxScenarios` (24), `maxExecuted` (20), `reproAttempts` (2), `testTimeoutSeconds` (60 per test), `totalTimeoutSeconds` (420); `--mode thorough` triples the scenario/execution budgets. Higher-priority scenarios (agent first, then by priority) are executed first; the rest are listed as skipped with the reason.

## Measured benchmark (fixtures in this repo)
`tests/integration/discovery.test.ts` runs `flutter-app-buggy` (5 planted defects, none covered by its 3 passing tests) and `flutter-app-clean`. Last measured run: 5/5 planted bugs independently found (3 via agent scenarios with verified README references, 2 via engine seeding alone); 6 confirmed, all reproduced 6/6; clean app: 0 confirmed; control scenarios (assumption, fabricated quote, wrong target, unknown key) were suspected/suspected/invalid/rejected as designed; ~39 s for 13 executed scenarios. These are fixtures written for this project, not a claim about real-world detection rates.
