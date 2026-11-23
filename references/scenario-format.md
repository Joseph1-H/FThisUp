# Scenario formats (typed, restricted)

A scenario is **data**, never code. FThisUp validates every scenario against a strict schema; unknown fields, unknown actions and off-origin navigation are rejected before anything runs. Scenarios you propose are executed under the same safety policy as built-in ones (blocked/approval rules, no third-party traffic, request-rate caps).

```json
{
  "scenarios": [
    {
      "id": "checkout-empty-address",
      "name": "Checkout form with empty address",
      "category": "form-validation",
      "risk": "low",
      "target": "/checkout",
      "steps": [
        { "action": "goto", "path": "/checkout" },
        { "action": "submit", "selector": "form >> nth=0 >> button >> nth=0" }
      ],
      "expected": [
        { "type": "noUncaughtExceptions" },
        { "type": "noRequestWhenInvalid", "hard": true },
        { "type": "visibleFeedbackOnFailure" }
      ],
      "requiresApproval": false
    }
  ]
}
```

Fields: `id` (letters/digits/`.`/`_`/`:`/`-`), `name`, `category` (`navigation` | `form-validation` | `ui-chaos` | `network-failure` | `authentication`), `risk` (`low` | `medium` | `high`), `target` (a path on the app's origin), `steps` (max 40), `expected` (at least 1), `requiresApproval` (set `true` and a `sensitivity` of `deletion` | `purchase` | `account-creation` | `messaging` | `upload` | `irreversible` for anything that could do that), optional `description`, `component`.

## Actions (the complete list)
| action | fields |
|---|---|
| `goto` | `path` (same-origin path) |
| `click` | `selector` |
| `repeatClick` | `selector`, `times` (2-10), `delayMs` (0-1000) |
| `fill` | `selector`, `value` (max 20000 chars) |
| `fillAll` | `scope?` (selector of a form), `kind`: `valid` `long` `special` `unicode` `xss-marker` `invalid-email` `invalid-number` `empty` |
| `submit` | `selector` of the submit control |
| `press` | `key`: `Enter` `Escape` `Tab` `ArrowDown` `ArrowUp` |
| `reload`, `goBack`, `goForward`, `clearNetwork` | none |
| `setViewport` | `width` (200-3840), `height` (200-2160) |
| `setNetwork` | `mode`: `offline` `http500` `http429` `slow` `timeout`, `delayMs?`: affects only same-origin fetch/XHR, in the browser |
| `wait` | `ms` (0-5000) |
| `login`, `logout`, `expireSession`, `loginWithBadPassword` | none; `authentication` category only; uses the configured test account |

Selectors are Playwright selectors. Use the ones in `discovery.json` (`form >> nth=0`, `form >> nth=0 >> :is(input,textarea,select) >> nth=1`, ...) or stable ids/`data-testid`.

## Expectations (the complete list)
`noUncaughtExceptions`, `noBlankPage`, `pageStatusOk` (`hard?`), `noRedirectLoop`, `noMissingResources`, `noServerErrors`, `noHorizontalOverflow`, `noScriptInjection`, `noUnexpectedAuthRedirect`, `maxMutatingRequests` (`max`), `noRequestWhenInvalid` (`hard?`), `visibleFeedbackOnFailure`, `stillInteractive`, `urlNotMatches` (`pattern`), `gatedContent` (`loginPathPattern?`, `hard?`), `selectorVisible` / `selectorNotVisible` (`selector`), `loginFormVisible`.

"Hard" expectations are objectively measurable and can produce a **confirmed** finding once reproduced. Soft (heuristic) ones can only produce **suspected** findings.

## One file, three sections

```json
{ "scenarios": [ /* web (Playwright): below */ ],
  "cliScenarios": [ /* command-line apps */ ],
  "apiScenarios": [ /* HTTP APIs */ ] }
```

### `cliScenarios`
The **executable is never part of a scenario**; `target` names a discovered or configured CLI.
```json
{ "id": "tool-empty-config", "name": "Empty config file", "target": "mytool", "argv": ["--config", "x"],
  "stdin": { "kind": "empty" }, "signal": { "afterMs": 500, "name": "SIGINT" }, "timeoutMs": 5000,
  "expect": [{ "type": "noCrash" }, { "type": "noStackTrace" }, { "type": "terminates" }],
  "risk": "low", "requiresApproval": false }
```
`stdin.kind`: `empty` | `text` (`text`) | `unicode` | `binary` (`bytes` ≤ 1,000,000) | `long` (`bytes` ≤ 5,000,000). `argv`: ≤ 30 plain strings (no shell, no expansion, no NUL). Expectations: `noCrash`, `noStackTrace`, `terminates`, `exitCode` (`oneOf`), `nonZeroExit`, `stderrEmpty`, `stdoutContains`/`stderrContains` (`text`), `exitsWithinMs` (`ms`).

### `apiScenarios`
Only a **path** is supplied; the host is always the authorized API target. No `Host`/`Authorization`/`Cookie` headers.
```json
{ "id": "users-huge-name", "name": "Huge name", "method": "POST", "path": "/users",
  "json": { "name": "AAAA" }, "rawBody": "{broken", "contentType": "application/json",
  "query": { "a": "b" }, "headers": { "x-trace": "1" },
  "expect": [{ "type": "no5xx" }, { "type": "rejects" }], "risk": "medium" }
```
Use `json` (a value) **or** `rawBody` (a string, for deliberately malformed bodies), not both. Methods: GET/HEAD/OPTIONS/POST/PUT/PATCH/DELETE (DELETE needs `deletion` approval). Expectations: `no5xx`, `statusIn` (`codes`), `rejects` (4xx), `respondsWithinMs` (`ms`), `jsonBody`, `bodyContains` (`text`).

Validate before running: `npx fthisup test --url <url> --scenarios file.json --dry-run`.
