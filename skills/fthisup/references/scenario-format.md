# Scenario format (typed, restricted)

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

Validate before running: `npx fthisup test --url <url> --scenarios file.json --dry-run`.
