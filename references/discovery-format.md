# Autonomous discovery: typed scenario format (Flutter)

Write `fthisup-scenarios/flutter.json`. It is **data, never code**: there is no field for Dart, shell, URLs or hosts. The engine validates it, generates the widget tests itself, runs them in an isolated copy of the project, re-runs every failure, and classifies the result.

```json
{
  "version": 1,
  "adapter": "flutter",
  "component": ".",
  "scenarios": [
    {
      "id": "double-save",
      "name": "Tap Save twice quickly",
      "feature": "Workout logging",
      "risk": "duplicate submission creates two records",
      "priority": "high",
      "expectation": {
        "statement": "A workout is saved once; Save is disabled while saving",
        "basis": "documented",
        "reference": { "file": "README.md", "quote": "While a save is in progress the Save button is disabled" }
      },
      "hypothesis": "onPressed is not guarded by the saving flag (unverified idea, optional)",
      "screen": { "widget": "WorkoutScreen", "args": {}, "wrap": "materialApp", "viewport": { "width": 390, "height": 844 } },
      "steps": [
        { "do": "enterText", "target": { "by": "key", "value": "exercise_name" }, "text": "Squat" },
        { "do": "tap", "target": { "by": "key", "value": "save_button" } },
        { "do": "pump", "ms": 50 },
        { "do": "expect", "assert": { "kind": "buttonEnabled", "target": { "by": "key", "value": "save_button" }, "enabled": false } },
        { "do": "rapidTap", "target": { "by": "key", "value": "save_button" }, "times": 5 },
        { "do": "pump", "ms": 600 }
      ],
      "assertions": [ { "kind": "count", "target": { "by": "key", "value": "entry_1" }, "equals": 0 } ]
    }
  ]
}
```

## Fields
- `id` lowercase `a-z0-9_-`; `name`, `feature` (which app feature), `risk` (what could go wrong) are required.
- `expectation.basis`: `invariant` (no uncaught exception / layout overflow / use-after-dispose; no extra assertions), `documented` | `code` | `test` (need `reference.file` inside the project and a verbatim `quote`, which the engine checks), `assumption` (never more than "suspected"). A reference that cannot be verified downgrades the scenario to an assumption.
- `screen.widget`: a widget class from `app-map.json`. `args`: named constructor arguments, literal values only (needed when the widget has required parameters). `wrap`: `materialApp` (default) or `materialApp+scaffold`.

## Targets (`by`)
`key` (a `Key('..')`/`ValueKey('..')` that appears in the source), `text` (exact), `textContaining`, `type` (a Flutter widget such as ElevatedButton/TextField/ListView/Scaffold, or a widget of this project), `tooltip`, `label` (a TextField's label/hint text). Optional `index` picks the n-th match. Prefer `key`.

## Steps (`do`)
`enterText` (`text`: a string, `{"preset": "empty|whitespace|long|long-words|unicode|emoji|rtl|negative|zero|huge-number|decimal|markup|quote|newline"}`, or `{"repeat": {"unit": "ab", "times": 5000}}`), `tap`, `doubleTap`, `longPress`, `rapidTap` (`times` 2-20, `gapMs`), `drag`/`fling` (`dx`,`dy`), `scrollIntoView`, `pump` (`ms`), `settle`, `back` (system back), `dispose` (remove the widget, then wait `ms`), `expect` (an assertion in the middle of the sequence, e.g. while a save is pending), `repeat` (`times` 2-10, `steps`).

## Assertions
`visible`, `absent`, `count` (`equals`/`atLeast`/`atMost`), `buttonEnabled` (`enabled`: true/false). Uncaught exceptions, layout overflow and use-after-dispose are ALWAYS checked in addition.

## What the engine does with each scenario
`rejected` (schema/unknown widget/unknown key; never runs) → `skipped` (budget, unpumpable) → runs in an isolated copy → `invalid` (the test itself is wrong, e.g. a target not on screen) / `environment` (needs a backend, provider or plugin an isolated test lacks) / `passed` / `not-reproducible` / `suspected` / `confirmed` (reproduced on every independent re-run AND the expectation is an invariant or a verified reference).

Tips: pick keys from `app-map.json` (`keysInSource`); interpolated keys like `entry_$i` are allowed as `entry_0`. Number fields accept strings: `"text": "100"`. Put the check you care about in `assertions`, or use `expect` mid-sequence for in-flight state. Keep scenarios short and independent.
