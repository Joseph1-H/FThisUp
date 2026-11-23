---
name: fthisup
description: Prove the code works by actually trying to break it. Detects what the project contains (web app, HTTP API, CLI, Python/JS/Rust/Go/Flutter/Java/C++/Swift code, desktop app, Godot game; monorepos too), picks the right testing adapters, runs the project's own tests plus adversarial checks (hostile input, invalid requests, crashes, hangs, double submits, API failures, auth gaps), re-runs every failure to confirm it, and reports only what really failed with evidence and repro steps. Use when the user types /fthisup, or asks to "try to break", "stress test", "fuzz", "find bugs in", "test everything in", or "prove" their code works. "/fthisup fix" repairs confirmed bugs. "/fthisup update" updates FThisUp itself to the latest version.
argument-hint: "[fix | update] [url]"
license: MIT
compatibility: Requires Node.js 20+. Each adapter needs its own toolchain (Playwright Chromium for web, python3, cargo, flutter, ...). FThisUp never installs SDKs or dependencies; it reports what is missing. Works offline, no API keys.
metadata:
  version: "0.3.0"
---

# FThisUp: your code works? Prove it.

You orchestrate the **FThisUp CLI**. The CLI detects the project, picks adapters, executes real tests, reproduces failures and writes the evidence. **Never invent bugs, results, screenshots, logs or coverage.** If it is not in `fthisup-results/results.json`, it did not happen.

If the first argument is `fix`, stop here and follow [references/fix.md](references/fix.md) instead.

If the first argument is `update`, do only this and stop: run `fthisup update` (it works from any directory, touches only FThisUp's own install and skill folders, and never your project). Relay its output faithfully: it states either the version change or that there is no new version. Use `fthisup update --check` to only look. If it updated anything, tell the user to restart the agent session so the new skill loads. Do not run any tests.

FThisUp is **not published to npm**, so plain `npx fthisup` does not work. Wherever this skill says `fthisup <cmd>`, run `fthisup <cmd>` if it is on PATH (`fthisup --version`), otherwise `npx --yes git+https://github.com/Joseph1-H/FThisUp.git <cmd>`. Run from the project root.

## Scope: this project only
FThisUp works on **the project in the current working directory and nothing else.** It refuses to run outside a project (or in your home directory), keeps all reads/writes inside the project, and refuses a target server that belongs to a different project. Do not work around this: never `cd` elsewhere to run it, never point it at another project's server, never use `--url`/`--api-url` for an app from a different repo. If it reports a scope block, relay the reason and ask the user. The only supported way to declare an unusual setup (e.g. the app runs in Docker) is a `"url"` in this project's own `fthisup.config.json`, and only if the user confirms it is this project's app.

## 1. Identify the project
Read the top-level layout (package.json, pyproject.toml, Cargo.toml, go.mod, pubspec.yaml, pom.xml, CMakeLists.txt, Package.swift, project.godot, ...). A repo can contain several independent components (monorepo). Note the dev/start command and port of any web app or API. Check for an existing `fthisup.config.json`. If a URL was given as an argument, use it.

## 2. Confirm a safe target
- Network targets (web, API): `localhost`, `127.0.0.1`, `::1` only by default.
- For anything else the user must own or be authorized to test it, and `fthisup.config.json` needs `safety.allowedHosts`, `safety.authorized: true` and `safety.environment` (`staging`, or `production` = strictly read-only). **Only write those settings if the user explicitly says they are authorized.** Never loosen safety settings to make a run succeed. If the CLI says "Blocked by safety policy", relay the reason and stop.
- Never point FThisUp at third-party sites. Credentials for auth tests come only from environment variables (`FTHISUP_TEST_USER`, `FTHISUP_TEST_PASSWORD`, `FTHISUP_API_TOKEN`) belonging to a dedicated TEST account; never put them in files or messages.
- It really sends hostile input and submits forms on localhost, so the app should use a throwaway database.

## 3. Check the environment
```bash
fthisup doctor
```
This prints which adapters can run **right now** and what each missing prerequisite needs. Tell the user what is missing; **never install SDKs, dependencies or browsers yourself** (suggest e.g. `npx playwright install chromium`, `npm install`, `flutter pub get`, then let the user run them). Ask before starting the user's dev server (or use `--start` when `startCommand` is configured).

## 4. Discover
```bash
fthisup scan
```
Writes `fthisup-results/project.json` (components, languages, frameworks, test commands, availability) and `discovery.json` (web routes/forms, static warnings). Facts marked `confirmed` came from manifests or the running app; `inferred` ones are heuristics.

## 5. Generate NEW adversarial scenarios (this is the point of FThisUp)
Existing tests only show what the developer already thought of. Your job here is to find what they did not. **Do not stop after the baseline run.**

1. Map the app: `fthisup discover` (add `--runtime` to list already-running devices). It writes `fthisup-results/app-map.json`: screens/widgets, fields, actions, handlers, persistence, async hazards, which widgets no existing test mentions, and a risk score. Read it, then **read the riskiest source files, the README/docs and the existing tests** to learn the expected behaviour.
2. Write project-specific scenarios to `fthisup-scenarios/flutter.json` (Flutter) using ONLY the typed format in [references/discovery-format.md](references/discovery-format.md). Think like an attacker of THIS app: negative/huge/empty/unicode input in the fields that matter, double and rapid submits, leaving a screen mid-save, interrupted/repeated persistence, gestures during animations. Prioritise business-critical operations, persistence, async work and uncovered interactions. Aim for 8-20 meaningful scenarios, not hundreds.
3. **Every scenario must say why the behaviour is expected** (`expectation.basis`): `documented` or `code` or `test` with a verbatim `quote` from a real file (the engine verifies it exists), `invariant` for "no uncaught exception/overflow/use-after-dispose", else `assumption`. Never invent a requirement or a quote. An assumption can only ever become "suspected".
4. Validate without executing: `fthisup test --dry-run --discovery`. Fix everything listed `[REJECTED]`.

For web/API/CLI projects the typed scenario files in [references/scenario-format.md](references/scenario-format.md) (`scenarios`, `cliScenarios`, `apiScenarios`, passed with `--scenarios`) play the same role; their results are tagged "generated" in the report. **Only Flutter has engine-side app mapping and test generation today**; for other ecosystems say so plainly instead of implying autonomous discovery happened.

If you cannot write scenarios (no source access, tool limits) or cannot run the engine safely, **say that explicitly** in your summary; do not silently fall back to "existing tests only". The engine still runs its own seeded invariant scenarios with `--discovery`.

## 6. Run the real tests
```bash
fthisup test --discovery          # DEFAULT for /fthisup: baseline tests + new generated tests (agent scenarios + seeded invariants)
fthisup test                      # automatic: every applicable adapter, no generated tests
fthisup test --url <url>          # also test the running web app / API
fthisup test --adapter api,cli    # only these adapters (python, javascript, flutter, rust, go, java, cpp, swift, godot, web, api, cli, desktop)
fthisup test --all                # include opt-in adapters (desktop builds and launches the app)
```
Exit code `1` = confirmed issues, `2` = safety/config block, `3` = nothing could run (e.g. app unreachable), `4` = an explicitly selected adapter cannot run / environment problem. Sensitive actions (delete, purchase, sign-up, messaging, upload, irreversible) are **blocked by design**; do not add `approvedActions` yourself. If the user wants them, ask first and name exactly which action.

## 7. Review and summarize
Report existing-test results and newly discovered results SEPARATELY (the report does too: findings marked NEW came from generated tests). For each generated finding check the evidence yourself: is the test valid, is the expectation supported (basis + verified reference), was it reproduced N/N? Say which scenarios were invalid, environment limits or rejected. Root causes you suggest are hypotheses unless you verified them in the code.
Read `fthisup-results/results.json`. Report in this order:
1. The plan: which components and adapters ran, which were skipped/unavailable and **why** (missing prerequisite + setup hint).
2. Headline numbers: executed, passed, failed, skipped, blocked.
3. **Confirmed** bugs (reproduced, hard evidence): title, severity, **component**, failure type, expected vs actual, repro steps, evidence (exact error/log/request/screenshot path).
4. **Suspected** and `not-reproducible` findings, clearly labelled as unconfirmed. Static-analysis warnings (`source: static-analysis`) are heuristics only.
5. **Distinguish failed assertions from defects.** `evidenceKind: "failed-assertion"` means the project's *own* test failed: that is a regression OR an outdated test, and you cannot tell which without reading both. `observed-defect` means FThisUp provoked and observed the misbehaviour.
6. Blocked/skipped scenarios and why. Caveats: passing tests do not prove the project is bug-free; coverage is never complete.

## 8. Suggest fixes (do not apply them)
For each confirmed bug, point to the likely file/line (search the code for the route/function/component named in the finding) and propose a concrete fix. **Do not modify application code in this workflow.** Offer: "Run `/fthisup fix` to apply fixes with your approval."

Report path for the user: `fthisup-results/report.html` (self-contained, works offline).
