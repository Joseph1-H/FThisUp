# Architecture

```
CLI ──► runner ──► evaluateTarget (policy) ──► probe URL ──► launch Chromium
                       │
        discoverProject (static, confirmed/inferred) + analyzeStatic (warnings)
        discoverLive    (crawl: pages, forms, buttons, API calls) ── through SafetyGuard
        generateScenarios (deterministic) + validateScenarios (agent file)
                       │
        for each scenario:
           executeScenario ── SafetyGuard.checkScenario ── isolated browser context
                 │              every request ► guard.checkRequest ► route / fault injection
                 │              steps (closed vocabulary) ► expectations (hard | soft)
                 ▼
           failed? → re-run once in a fresh context → status (confirmed | suspected | not-reproducible)
                       │
        results.json (redacted) ──► report.html (self-contained)
```

## Statuses
- **confirmed**: failed *and* reproduced on a fresh re-run *and* at least one reproduced failing expectation is **hard** (objectively measurable: uncaught exception, duplicate requests, HTTP 404 on a linked route, executed XSS marker, protected content visible...).
- **suspected**: reproduced but only soft/heuristic expectations failed, or reproduction was deliberately skipped (failed-login check), or a static-analysis warning.
- **not-reproducible**: failed once, passed on re-run.
- **skipped**: could not be evaluated (element missing, no credentials, app made no API call to fail...). Never reported as a bug.
- **blocked**: stopped by the safety policy.

Failed HTTP requests are not bugs by themselves. Only specific expectations turn evidence into a failure, and requests FThisUp injected are excluded from evidence of app misbehavior.

## Extending to other platforms
A platform engine must provide: a session with request/traffic guarding, executors for the typed actions, and evaluators for the expectations. Discovery produces the same `PageInfo`-like structure, and scenarios/reporting are platform-neutral. Flutter, React Native, Android and iOS are future work; v0.1 detects them during `scan` and says so, but does not test them.
