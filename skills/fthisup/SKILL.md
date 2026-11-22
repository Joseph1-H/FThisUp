---
name: fthisup
description: Break-test a web app by actually running it. Runs the real FThisUp engine (Playwright) against a local or explicitly authorized app - empty/invalid/huge form input, double submits, API failures (offline/500/429/timeout), broken links, narrow viewports, auth gating - then reports only what really failed, with screenshots and repro steps. Use when the user types /fthisup, or asks to "try to break", "stress test", "find bugs in", or "verify" a web app they or an AI built. "/fthisup fix" repairs confirmed bugs.
argument-hint: "[fix] [url]"
license: MIT
compatibility: Requires Node.js 20+ and a Playwright Chromium install. Browser-based apps only (no mobile/Flutter yet). Works offline; needs no API keys.
metadata:
  version: "0.1.0"
---

# FThisUp: break the app for real

You orchestrate the **FThisUp CLI**. The CLI does the testing (real browser, real requests). You decide what to run, then read and explain its output. **Never invent bugs, results, screenshots or coverage.** If it is not in `fthisup-results/results.json`, it did not happen.

If the first argument is `fix`, stop here and follow [references/fix.md](references/fix.md) instead.

Run the CLI as `npx fthisup ...` (or `node_modules/.bin/fthisup` if it is a dependency). Run from the project root.

## 1. Identify the project
Read `package.json` (or the equivalent) to learn the framework, the dev command and the port. Check for an existing `fthisup.config.json`. If a URL was given as an argument, use it.

## 2. Confirm a safe target
- Allowed by default: `localhost`, `127.0.0.1`, `::1` only.
- For anything else the user must own or be authorized to test it, and `fthisup.config.json` must contain `safety.allowedHosts`, `safety.authorized: true` and `safety.environment` (`staging` or `production`; production is read-only). **Only write those settings if the user explicitly tells you they are authorized.** Never loosen safety settings to make a run succeed. If the CLI reports "Blocked by safety policy", relay the reason and stop.
- Never point FThisUp at third-party sites, and never use real customer accounts. For auth testing use a dedicated test account passed through environment variables (`FTHISUP_TEST_USER`, `FTHISUP_TEST_PASSWORD`); never put credentials in files or in your messages.

## 3. Check the environment
```bash
npx fthisup doctor
```
If Chromium is missing, tell the user to run `npx playwright install chromium` (or `npx fthisup doctor --install`). Do not install anything silently. If the app is not running, ask before starting the user's dev server (or use `--start` when `startCommand` is configured).

## 4. Discover
```bash
npx fthisup scan
```
Writes `fthisup-results/discovery.json`. Facts marked `confirmed` came from manifests or the live app; `inferred` ones are heuristics. Skim it for routes, forms, auth flows and API calls.

## 5. (Optional) Propose extra scenarios
Only if discovery shows flows the deterministic generator cannot know about (multi-step wizards, custom widgets). Write them to `fthisup-results/agent-scenarios.json` using **only** the typed vocabulary in [references/scenario-format.md](references/scenario-format.md): no shell, no JavaScript. Validate without executing:
```bash
npx fthisup test --url <url> --scenarios fthisup-results/agent-scenarios.json --dry-run
```
Fix anything listed as `[REJECTED]`. Skip this step when the defaults are enough.

## 6. Run the real tests
```bash
npx fthisup test --url <url> [--scenarios fthisup-results/agent-scenarios.json]
```
Exit code `1` means confirmed issues were found, `2` safety/config block, `3` app unreachable, `4` environment problem. Sensitive scenarios (delete, purchase, sign-up, messaging, upload, irreversible) are **blocked by design**. Do not add `approvedActions` yourself; if the user wants them, ask first and name exactly which action.

## 7. Review and summarize
Read `fthisup-results/results.json` (and open `report.html` references/screenshots if useful). Report in this order:
1. Headline numbers: executed, passed, failed, skipped, blocked.
2. **Confirmed** bugs (reproduced, hard evidence): title, severity, route, expected vs actual, the repro steps, and the evidence (exact error / requests / screenshot path).
3. **Suspected** issues and `not-reproducible` ones, clearly labelled as unconfirmed. Static-analysis warnings (`source: static-analysis`) are heuristics only.
4. Skipped/blocked scenarios and why (e.g. "Delete all notes" button blocked by policy).
5. Honest caveats: passing tests do not prove the app is bug-free.

## 8. Suggest fixes (do not apply them)
For each confirmed bug, point to the likely file/line (search the code for the route/component), and propose a concrete fix. **Do not modify application code during this workflow.** Offer: "Run `/fthisup fix` to apply fixes with your approval."

Report path for the user: `fthisup-results/report.html` (self-contained, works offline).
