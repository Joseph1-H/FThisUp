import { z } from 'zod';
import { scenarioMetaShape } from '../types.js';

/** Typed Flutter scenario. There is deliberately NO field that carries code, a shell command or a URL. */

const SAFE_WIDGET_TYPES = new Set([
  'ElevatedButton', 'FilledButton', 'TextButton', 'OutlinedButton', 'IconButton', 'FloatingActionButton', 'TextField', 'TextFormField', 'ListView', 'ListTile',
  'Checkbox', 'Switch', 'Slider', 'Dismissible', 'Card', 'AppBar', 'InkWell', 'GestureDetector', 'Text', 'Icon', 'DropdownButton', 'Scaffold', 'Column', 'Row',
]);
export const isFrameworkWidget = (n: string) => SAFE_WIDGET_TYPES.has(n);

export const finderSchema = z
  .object({
    by: z.enum(['key', 'text', 'textContaining', 'type', 'tooltip', 'label']),
    value: z.string().min(1).max(200),
    /** which match to use when several widgets match (default: the first) */
    index: z.number().int().min(0).max(50).optional(),
  })
  .strict();
export type Finder = z.infer<typeof finderSchema>;

export const TEXT_PRESETS = ['empty', 'whitespace', 'long', 'long-words', 'unicode', 'emoji', 'rtl', 'negative', 'zero', 'huge-number', 'decimal', 'markup', 'quote', 'newline'] as const;
export const textSchema = z.union([
  z.string().max(2000),
  z.object({ preset: z.enum(TEXT_PRESETS) }).strict(),
  z.object({ repeat: z.object({ unit: z.string().min(1).max(20), times: z.number().int().min(1).max(50_000) }).strict() }).strict(),
]);
export type TextValue = z.infer<typeof textSchema>;

const assertionBase = { target: finderSchema };
export const assertionSchema = z.union([
  z.object({ kind: z.literal('visible'), ...assertionBase }).strict(),
  z.object({ kind: z.literal('absent'), ...assertionBase }).strict(),
  z
    .object({ kind: z.literal('count'), ...assertionBase, equals: z.number().int().min(0).max(1000).optional(), atLeast: z.number().int().min(0).max(1000).optional(), atMost: z.number().int().min(0).max(1000).optional() })
    .strict()
    .refine((a) => a.equals !== undefined || a.atLeast !== undefined || a.atMost !== undefined, 'count needs equals, atLeast or atMost'),
  z.object({ kind: z.literal('buttonEnabled'), ...assertionBase, enabled: z.boolean() }).strict(),
]);
export type Assertion = z.infer<typeof assertionSchema>;

const t = finderSchema;
const leaf = [
  z.object({ do: z.literal('enterText'), target: t, text: textSchema }).strict(),
  z.object({ do: z.literal('tap'), target: t }).strict(),
  z.object({ do: z.literal('doubleTap'), target: t }).strict(),
  z.object({ do: z.literal('longPress'), target: t }).strict(),
  z.object({ do: z.literal('rapidTap'), target: t, times: z.number().int().min(2).max(20), gapMs: z.number().int().min(0).max(300).default(0) }).strict(),
  z.object({ do: z.literal('drag'), target: t, dx: z.number().min(-2000).max(2000), dy: z.number().min(-2000).max(2000) }).strict(),
  z.object({ do: z.literal('fling'), target: t, dx: z.number().min(-2000).max(2000), dy: z.number().min(-2000).max(2000) }).strict(),
  z.object({ do: z.literal('scrollIntoView'), target: t }).strict(),
  z.object({ do: z.literal('pump'), ms: z.number().int().min(0).max(5000) }).strict(),
  z.object({ do: z.literal('settle') }).strict(),
  /** system back button / Navigator.pop of the top route */
  z.object({ do: z.literal('back') }).strict(),
  /** remove the widget from the tree (widget disposal), then let timers run for `ms` */
  z.object({ do: z.literal('dispose'), ms: z.number().int().min(0).max(10_000).default(2000) }).strict(),
  z.object({ do: z.literal('expect'), assert: assertionSchema }).strict(),
] as const;

export type Step =
  | z.infer<(typeof leaf)[number]>
  | { do: 'repeat'; times: number; steps: Step[] };

export const stepSchema: z.ZodType<Step> = z.lazy(() =>
  z.union([
    ...leaf,
    z.object({ do: z.literal('repeat'), times: z.number().int().min(2).max(10), steps: z.array(stepSchema).min(1).max(10) }).strict(),
  ]),
) as z.ZodType<Step>;

const argValue = z.union([z.string().max(300), z.number(), z.boolean(), z.null()]);

export const flutterScenarioSchema = z
  .object({
    ...scenarioMetaShape,
    method: z.enum(['agent', 'engine-heuristic']).optional(),
    screen: z
      .object({
        /** class name of the widget to pump (must exist in the app map) */
        widget: z.string().regex(/^[A-Z][A-Za-z0-9_]*$/),
        /** named constructor arguments, literal values only */
        args: z.record(z.string().regex(/^[a-z_][A-Za-z0-9_]*$/), argValue).default({}),
        wrap: z.enum(['materialApp', 'materialApp+scaffold']).default('materialApp'),
        viewport: z.object({ width: z.number().min(200).max(2000), height: z.number().min(200).max(3000) }).strict().default({ width: 390, height: 844 }),
      })
      .strict(),
    steps: z.array(stepSchema).min(1).max(40),
    /** evaluated after all steps */
    assertions: z.array(assertionSchema).max(10).default([]),
  })
  .strict();
export type FlutterScenario = z.infer<typeof flutterScenarioSchema>;

export const flutterScenarioFileSchema = z
  .object({
    version: z.literal(1).default(1),
    adapter: z.literal('flutter'),
    /** optional: which component (pubspec folder, relative path) these scenarios target; default = the only Flutter component */
    component: z.string().max(200).optional(),
    scenarios: z.array(z.unknown()).max(300),
  })
  .strict();
