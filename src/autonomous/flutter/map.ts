import fs from 'node:fs';
import path from 'node:path';
import { findCalls, keyOf, lineOf, mask, matchClose, splitArgs, strLiteral } from './dart-scan.js';

export interface FieldInfo { kind: 'text-field' | 'control'; widget: string; key?: string; label?: string; hint?: string; keyboard?: string; hasValidator: boolean; obscure: boolean; line: number }
export interface ActionInfo { kind: 'button' | 'gesture'; widget: string; key?: string; label?: string; tooltip?: string; gesture?: string; handler?: string; guardedWhilePending: boolean; line: number }
export interface HandlerInfo { name: string; line: number; async: boolean; awaits: number; persistence: string[]; setStateAfterAwait: boolean; checksMounted: boolean; navigates: boolean; validates: boolean }
export interface CtorParam { name: string; type?: string; required: boolean }
export interface ScreenInfo {
  class: string; file: string; line: number; isScreen: boolean; stateful: boolean;
  constructor: { namedParams: CtorParam[]; positionalRequired: number; pumpable: boolean; reason?: string };
  dependsOn: string[];
  fields: FieldInfo[]; actions: ActionInfo[]; handlers: HandlerInfo[];
  navigatesTo: string[]; persistence: string[]; scrollables: number; gestures: string[];
  async: boolean; dynamicList: boolean;
  covered: boolean; uncoveredInteractions: string[];
  risk: number; riskReasons: string[];
}
export interface ExistingTests { files: string[]; testCount: number; widgetTestCount: number; referencedClasses: string[] }
export interface FlutterAppMap {
  adapter: 'flutter';
  component: string;
  package: string;
  fthisupVersion: string;
  generatedAt: string;
  integrations: string[];
  screens: ScreenInfo[];
  models: Array<{ class: string; file: string; serializes: boolean }>;
  services: Array<{ class: string; file: string; persistence: string[] }>;
  keysInSource: string[];
  existingTests: ExistingTests;
  supabase: { used: boolean; tables: string[]; operations: string[]; hardCodedEndpoints: string[] };
  runtime: { integrationTestDir: boolean; integrationTestDependency: boolean };
  totals: Record<string, number>;
  limitations: string[];
}

const WIDGET_BASE = /^(StatelessWidget|StatefulWidget|ConsumerWidget|ConsumerStatefulWidget|HookWidget|HookConsumerWidget|StatelessHookWidget|GetView|GetWidget)$/;
const STATE_BASE = /^(State|ConsumerState)$/;
const BUTTONS = ['ElevatedButton', 'FilledButton', 'TextButton', 'OutlinedButton', 'IconButton', 'FloatingActionButton', 'PopupMenuButton', 'MaterialButton', 'CupertinoButton', 'ListTile', 'InkWell', 'GestureDetector', 'Dismissible'];
const FIELDS = ['TextField', 'TextFormField', 'CupertinoTextField'];
const CONTROLS = ['Checkbox', 'Switch', 'Slider', 'DropdownButton', 'DropdownButtonFormField', 'Radio', 'CheckboxListTile', 'SwitchListTile'];
const PERSIST = /\.(insert|update|delete|upsert|rpc|setString|setInt|setBool|setDouble|setStringList|remove|put|putAll|writeAsString|writeAsBytes|rawInsert|rawUpdate|rawDelete)\s*\(/g;
const BACKEND = [
  [/Supabase\.instance|SupabaseClient|supabase\b/i, 'Supabase'], [/Firebase\w*\.|FirebaseAuth|FirebaseFirestore/, 'Firebase'],
  [/context\.(?:read|watch|select)\s*</, 'Provider'], [/Provider\.of\s*</, 'Provider'], [/\bref\.(?:watch|read|listen)\s*\(/, 'Riverpod'],
  [/\bGetIt\b|\bGet\.find\b/, 'service locator'], [/Bloc(?:Provider|Builder|Consumer)|context\.read<\w*Bloc/, 'Bloc'],
] as const;

const read = (p: string) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };

function walk(dir: string, ext: string, limit = 600): string[] {
  const out: string[] = [];
  const rec = (d: string) => {
    let ents: fs.Dirent[] = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (out.length >= limit) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!/^\.|^build$/.test(e.name)) rec(p); }
      else if (e.name.endsWith(ext)) out.push(p);
    }
  };
  rec(dir);
  return out.sort();
}

interface ClassDef { name: string; extendsName: string; extendsArg?: string; start: number; bodyStart: number; bodyEnd: number; file: string }

function classesOf(src: string, masked: string, file: string): ClassDef[] {
  const out: ClassDef[] = [];
  const re = /(?:^|\n)\s*(?:abstract\s+|final\s+|base\s+|sealed\s+|interface\s+|mixin\s+)*class\s+(\w+)([^{;]*)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked))) {
    const open = m.index + m[0].length - 1;
    const close = matchClose(masked, open);
    if (close < 0) continue;
    const ext = /\bextends\s+([\w.]+)\s*(?:<\s*([\w.?]+)[^>]*>)?/.exec(m[2]!);
    out.push({ name: m[1]!, extendsName: ext?.[1] ?? '', extendsArg: ext?.[2], start: m.index, bodyStart: open + 1, bodyEnd: close, file });
  }
  void src;
  return out;
}

function ctorOf(cls: ClassDef, src: string, masked: string): ScreenInfo['constructor'] {
  const body = masked.slice(cls.bodyStart, cls.bodyEnd);
  const re = new RegExp(`(?:^|[\\s;{}])(?:const\\s+)?${cls.name}\\s*\\(`, 'g');
  const m = re.exec(body);
  if (!m) return { namedParams: [], positionalRequired: 0, pumpable: true };
  const open = cls.bodyStart + m.index + m[0].length - 1;
  const close = matchClose(masked, open);
  const orig = src.slice(open + 1, close);
  const mk = masked.slice(open + 1, close);
  const braceAt = mk.indexOf('{');
  const positionalText = (braceAt === -1 ? orig : orig.slice(0, braceAt)).split(',').map((s) => s.trim()).filter(Boolean);
  const namedText = braceAt === -1 ? '' : orig.slice(braceAt + 1, mk.lastIndexOf('}') === -1 ? undefined : mk.lastIndexOf('}'));
  const fieldType = (n: string) => new RegExp(`(?:final|late)\\s+([\\w<>?, ]+?)\\s+${n}\\s*;`).exec(src.slice(cls.bodyStart, cls.bodyEnd))?.[1]?.trim();
  const named: CtorParam[] = [];
  const parts: string[] = [];
  let depth = 0, last = 0;
  const nm = braceAt === -1 ? '' : mk.slice(braceAt + 1);
  for (let i = 0; i < nm.length; i++) { const ch = nm[i]; if ('([{<'.includes(ch!)) depth++; else if (')]}>'.includes(ch!)) depth--; else if (ch === ',' && depth === 0) { parts.push(namedText.slice(last, i)); last = i + 1; } }
  if (namedText.slice(last).trim()) parts.push(namedText.slice(last));
  for (const p of parts) {
    const t = p.trim();
    if (!t || /super\.key|Key\??\s+key/.test(t)) continue;
    const required = /^required\b/.test(t);
    const hasDefault = t.includes('=');
    const mm = /(?:this\.|\s)(\w+)\s*(?:=.*)?$/.exec(t.replace(/\s*=.*$/, ''));
    const name = mm?.[1];
    if (!name) continue;
    const typed = /^(?:required\s+)?(?:final\s+)?([\w<>?]+)\s+\w+$/.exec(t.replace(/\s*=.*$/, ''));
    named.push({ name, type: (typed && !/^this/.test(typed[1]!) ? typed[1] : undefined) ?? fieldType(name), required: required && !hasDefault });
  }
  const positionalRequired = positionalText.filter((p) => !/^\[|=/.test(p)).length;
  const req = named.filter((p) => p.required);
  const pumpable = positionalRequired === 0 && req.length === 0;
  return { namedParams: named, positionalRequired, pumpable, reason: pumpable ? undefined : `needs ${[...(positionalRequired ? [`${positionalRequired} positional argument(s)`] : []), ...req.map((r) => `${r.name}${r.type ? `: ${r.type}` : ''}`)].join(', ')}` };
}

function analyzeHandlers(content: string, contentMasked: string, baseLine: number): HandlerInfo[] {
  const out: HandlerInfo[] = [];
  const re = /(?:^|\n)\s*(?:@override\s+)?(?:Future<[^>{;]*>|Future|FutureOr<[^>{;]*>|void|bool|String|int)\s+(_?\w+)\s*\(([^)]*)\)\s*(async)?\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(contentMasked))) {
    const name = m[1]!;
    if (['build', 'initState', 'dispose', 'didChangeDependencies', 'didUpdateWidget', 'createState'].includes(name)) continue;
    const open = m.index + m[0].length - 1;
    const close = matchClose(contentMasked, open);
    if (close < 0) continue;
    const body = content.slice(open + 1, close);
    const bm = contentMasked.slice(open + 1, close);
    const awaits = (bm.match(/\bawait\b/g) ?? []).length;
    const firstAwait = bm.search(/\bawait\b/);
    const persistence = [...new Set([...body.matchAll(PERSIST)].map((x) => x[1]!))];
    if (/\.from\s*\(\s*['"]/.test(body)) persistence.push('from(table)');
    if (/\b_?(?:repo|repository|db|database|storage|store|service|api)\w*\.\w+\s*\(/i.test(body) && awaits) persistence.push('repository call');
    out.push({
      name, line: baseLine + content.slice(0, m.index).split('\n').length, async: !!m[3], awaits, persistence: [...new Set(persistence)],
      setStateAfterAwait: firstAwait >= 0 && /\bsetState\s*\(/.test(bm.slice(firstAwait)),
      checksMounted: /\bmounted\b/.test(bm), navigates: /Navigator\.|context\.(?:go|push|pop)|Get\.(?:to|back)/.test(bm),
      validates: /\b(?:if\s*\([^)]*(?:isEmpty|<=|<|>=|>|== null|\.trim\(\)\.isEmpty|tryParse)|validate\(\)|\.isNaN)/.test(bm) || /tryParse|validator/.test(bm),
    });
  }
  return out;
}

export function buildFlutterMap(root: string, compPath: string, version: string): FlutterAppMap {
  const dir = path.resolve(root, compPath);
  const pub = read(path.join(dir, 'pubspec.yaml'));
  const pkg = /^name:\s*(\S+)/m.exec(pub)?.[1] ?? 'app';
  const libFiles = walk(path.join(dir, 'lib'), '.dart');
  const testFiles = [...walk(path.join(dir, 'test'), '.dart'), ...walk(path.join(dir, 'integration_test'), '.dart')];
  const testSrc = testFiles.map(read).join('\n');
  const limitations: string[] = [];
  const allKeys = new Set<string>();
  const screens: ScreenInfo[] = [];
  const models: FlutterAppMap['models'] = [];
  const services: FlutterAppMap['services'] = [];
  const supa = { used: false, tables: new Set<string>(), ops: new Set<string>(), endpoints: new Set<string>() };
  const integrations = new Set<string>();
  for (const [dep, label] of [['supabase_flutter', 'Supabase'], ['firebase_core', 'Firebase'], ['cloud_firestore', 'Firebase'], ['shared_preferences', 'shared_preferences'], ['sqflite', 'SQLite'], ['hive', 'Hive'], ['drift', 'Drift'], ['isar', 'Isar'], ['provider', 'Provider'], ['flutter_riverpod', 'Riverpod'], ['riverpod', 'Riverpod'], ['flutter_bloc', 'Bloc'], ['get', 'GetX'], ['go_router', 'go_router'], ['http', 'http'], ['dio', 'dio']] as const) if (new RegExp(`^\\s{2}${dep}\\s*:`, 'm').test(pub)) integrations.add(label);

  const parsed = libFiles.map((f) => { const src = read(f); if (src.length > 600_000) { limitations.push(`${path.relative(dir, f)} skipped (larger than 600 KB)`); return null; } return { f, src, masked: mask(src) }; }).filter((x): x is { f: string; src: string; masked: string } => !!x);
  if (libFiles.length >= 600) limitations.push('only the first 600 Dart files under lib/ were scanned');

  const screenByName = new Map<string, ScreenInfo>();
  for (const { f, src, masked } of parsed) {
    const rel = path.relative(dir, f).split(path.sep).join('/');
    for (const m of src.matchAll(/(['"])(key[\w.-]*|[\w.-]+)\1/g)) void m; // keys are collected per call below
    for (const u of src.matchAll(/https?:\/\/[\w.-]+\.supabase\.(?:co|in)\b[^\s'")]*/g)) supa.endpoints.add(u[0]);
    if (/Supabase\.instance|supabase_flutter/.test(src)) supa.used = true;
    for (const t of src.matchAll(/\.from\s*\(\s*['"]([\w.-]+)['"]\s*\)\s*\.\s*(select|insert|update|upsert|delete)/g)) { supa.tables.add(t[1]!); supa.ops.add(`${t[1]}.${t[2]}`); }
    const classes = classesOf(src, masked, rel);
    for (const cls of classes) {
      const body = src.slice(cls.bodyStart, cls.bodyEnd);
      const bm = masked.slice(cls.bodyStart, cls.bodyEnd);
      if (!WIDGET_BASE.test(cls.extendsName.split('.').pop() ?? '')) {
        if (/\bfromJson\b|\btoJson\b|\btoMap\b|\bfromMap\b/.test(body)) models.push({ class: cls.name, file: rel, serializes: true });
        const persistence = [...new Set([...body.matchAll(PERSIST)].map((x) => x[1]!))];
        if (/Repository|Service|Controller|Store|Bloc|Cubit|Notifier|Provider|Manager|Dao|Api\b/.test(cls.name) && (persistence.length || /\.from\s*\(/.test(body))) services.push({ class: cls.name, file: rel, persistence });
        continue;
      }
      const stateful = /Stateful/.test(cls.extendsName) || classes.some((c) => STATE_BASE.test(c.extendsName) && c.extendsArg === cls.name);
      const stateCls = classes.filter((c) => STATE_BASE.test(c.extendsName) && c.extendsArg === cls.name);
      const parts = [{ c: cls, text: body, mk: bm }, ...stateCls.map((c) => ({ c, text: src.slice(c.bodyStart, c.bodyEnd), mk: masked.slice(c.bodyStart, c.bodyEnd) }))];
      const content = parts.map((p) => p.text).join('\n');
      const contentMasked = parts.map((p) => p.mk).join('\n');
      const line = lineOf(src, cls.start + 1);
      const fields: FieldInfo[] = [];
      const actions: ActionInfo[] = [];
      for (const part of parts) {
        const base = part.c.bodyStart;
        const lineAt = (i: number) => lineOf(src, base + i);
        for (const call of findCalls(part.text, part.mk, [...FIELDS, ...CONTROLS])) {
          const { named } = splitArgs(call.args, call.argsMasked);
          const dec = named.decoration ?? '';
          const label = strLiteral(/labelText\s*:\s*([\s\S]*?)(?:,|\)\s*$)/.exec(dec)?.[1]) ?? strLiteral(named.label);
          const hint = strLiteral(/hintText\s*:\s*([\s\S]*?)(?:,|\)\s*$)/.exec(dec)?.[1]);
          const key = keyOf(named.key);
          if (key) allKeys.add(key);
          fields.push({ kind: FIELDS.includes(call.name) ? 'text-field' : 'control', widget: call.name, key, label, hint, keyboard: /TextInputType\.(\w+)/.exec(named.keyboardType ?? '')?.[1], hasValidator: 'validator' in named, obscure: /true/.test(named.obscureText ?? ''), line: lineAt(call.start) });
        }
        for (const call of findCalls(part.text, part.mk, BUTTONS)) {
          const { named } = splitArgs(call.args, call.argsMasked);
          const key = keyOf(named.key);
          if (key) allKeys.add(key);
          const handlerExpr = named.onPressed ?? named.onTap ?? named.onDismissed ?? named.onSelected ?? named.onLongPress ?? named.onDoubleTap ?? '';
          const gesture = (['onTap', 'onLongPress', 'onDoubleTap', 'onPanUpdate', 'onHorizontalDragEnd', 'onVerticalDragEnd', 'onScaleUpdate', 'onDismissed'] as const).find((g) => g in named);
          if (['GestureDetector', 'InkWell', 'Dismissible', 'ListTile'].includes(call.name) && !gesture && !('onPressed' in named)) continue;
          const hm = /^(?:this\.)?(_?[a-z]\w*)\s*$/.exec(handlerExpr) ?? /(?:=>|\{)\s*(?:await\s+)?(?:this\.)?(_?[a-z]\w*)\s*\(/.exec(handlerExpr);
          actions.push({
            kind: ['GestureDetector', 'InkWell', 'Dismissible'].includes(call.name) ? 'gesture' : 'button', widget: call.name, key,
            label: strLiteral(named.child) ?? strLiteral(named.label) ?? strLiteral(named.title), tooltip: strLiteral(named.tooltip), gesture, handler: hm?.[1],
            guardedWhilePending: /\?\s*null|:\s*null|null\s*:|\?\?|\b\w*(?:saving|loading|busy|pending|submitting|inFlight|isSubmitting|disabled)\w*\b/i.test(handlerExpr) || /^\s*null\s*$/.test(handlerExpr),
            line: lineAt(call.start),
          });
        }
        for (const k of part.text.matchAll(/\bkey:\s*(?:const\s+)?(?:Key|ValueKey(?:<\s*String\s*>)?)\(\s*(['"])([^'"\n]*\$[^'"\n]*)\1\s*\)/g)) allKeys.add(k[2]!);
        for (const k of part.text.matchAll(/\bkey:\s*(?:const\s+)?(?:Key|ValueKey(?:<\s*String\s*>)?)\(\s*(['"])([\w.\-]+)\1\s*\)/g)) allKeys.add(k[2]!);
      }
      const handlers = analyzeHandlers(content, contentMasked, line);
      const persistence = [...new Set([...handlers.flatMap((h) => h.persistence)])];
      const dependsOn = [...new Set(BACKEND.filter(([re]) => re.test(content)).map(([, l]) => l))];
      const navigatesTo = [...new Set([...content.matchAll(/(?:MaterialPageRoute|CupertinoPageRoute)\s*(?:<[^>]*>)?\(\s*builder\s*:\s*\([^)]*\)\s*=>\s*(?:const\s+)?([A-Z]\w*)\s*\(/g)].map((x) => x[1]!))];
      const scrollables = findCalls(content, contentMasked, ['ListView', 'GridView', 'SingleChildScrollView', 'CustomScrollView', 'PageView']).length;
      const gestures = [...new Set(actions.filter((a) => a.kind === 'gesture').map((a) => a.gesture ?? a.widget))];
      const isScreen = /\bScaffold\s*\(|CupertinoPageScaffold\s*\(/.test(content) || /(Screen|Page|View)$/.test(cls.name);
      screens.push({
        class: cls.name, file: rel, line, isScreen, stateful,
        constructor: ctorOf(cls, src, masked), dependsOn, fields, actions, handlers, navigatesTo, persistence, scrollables, gestures,
        async: handlers.some((h) => h.async), dynamicList: /ListView\.builder|GridView\.builder|\bfor\s*\(.*\)\s*(?:ListTile|Row|Card)|\.map\s*\(/.test(content),
        covered: false, uncoveredInteractions: [], risk: 0, riskReasons: [],
      });
    }
  }
  for (const s of screens) screenByName.set(s.class, s);

  // ---- existing test coverage + risk ------------------------------------------------------------
  const referenced = [...new Set(screens.filter((s) => new RegExp(`\\b${s.class}\\b`).test(testSrc)).map((s) => s.class))];
  const testCount = (testSrc.match(/\b(?:test|testWidgets|blocTest)\s*\(/g) ?? []).length;
  const widgetTestCount = (testSrc.match(/\btestWidgets\s*\(/g) ?? []).length;
  for (const s of screens) {
    s.covered = referenced.includes(s.class);
    const tested = (label?: string, key?: string) => (key && testSrc.includes(key)) || (label && testSrc.includes(label));
    s.uncoveredInteractions = [
      ...s.fields.filter((f) => !tested(f.label ?? f.hint, f.key)).map((f) => `field ${f.key ?? f.label ?? f.hint ?? f.widget}`),
      ...s.actions.filter((a) => !tested(a.label ?? a.tooltip, a.key)).map((a) => `${a.kind} ${a.key ?? a.label ?? a.tooltip ?? a.widget}`),
    ];
    const why: Array<[number, string]> = [];
    if (s.fields.some((f) => f.kind === 'text-field')) why.push([2 + Math.min(3, s.fields.length), `user input (${s.fields.length} field(s))`]);
    const unguardedAsync = s.actions.filter((a) => !a.guardedWhilePending && s.handlers.find((h) => h.name === a.handler)?.async);
    if (unguardedAsync.length) why.push([3, `async action without a pending-state guard (${unguardedAsync.map((a) => a.key ?? a.label ?? a.widget).join(', ')})`]);
    if (s.persistence.length) why.push([3, `persistence (${s.persistence.join(', ')})`]);
    if (s.handlers.some((h) => h.setStateAfterAwait && !h.checksMounted)) why.push([3, 'setState after await without a mounted check']);
    if (s.handlers.some((h) => h.async && h.navigates)) why.push([2, 'navigation inside async handler']);
    if (s.fields.length && !s.fields.some((f) => f.hasValidator) && !s.handlers.some((h) => h.validates)) why.push([2, 'inputs with no visible validation']);
    if (s.gestures.length) why.push([1, `gestures (${s.gestures.join(', ')})`]);
    if (s.scrollables) why.push([1, 'scrollable content']);
    if (!s.covered) why.push([3, 'no existing test references this widget']);
    else if (s.uncoveredInteractions.length) why.push([1, `${s.uncoveredInteractions.length} interaction(s) not mentioned in existing tests`]);
    s.risk = why.reduce((n, [w]) => n + w, 0);
    s.riskReasons = why.map(([, r]) => r);
  }
  screens.sort((a, b) => b.risk - a.risk);

  const interactive = screens.filter((s) => s.fields.length || s.actions.length);
  return {
    adapter: 'flutter', component: compPath, package: pkg, fthisupVersion: version, generatedAt: new Date().toISOString(),
    integrations: [...integrations], screens, models, services, keysInSource: [...allKeys].sort(),
    existingTests: { files: testFiles.map((f) => path.relative(dir, f).split(path.sep).join('/')), testCount, widgetTestCount, referencedClasses: referenced },
    supabase: { used: supa.used || integrations.has('Supabase'), tables: [...supa.tables], operations: [...supa.ops], hardCodedEndpoints: [...supa.endpoints] },
    runtime: { integrationTestDir: fs.existsSync(path.join(dir, 'integration_test')), integrationTestDependency: /integration_test\s*:/.test(pub) },
    totals: {
      dartFiles: parsed.length, widgets: screens.length, screens: screens.filter((s) => s.isScreen).length, forms: screens.filter((s) => s.fields.some((f) => f.kind === 'text-field')).length,
      inputFields: screens.reduce((n, s) => n + s.fields.length, 0), actions: screens.reduce((n, s) => n + s.actions.length, 0), persistenceWorkflows: screens.filter((s) => s.persistence.length).length,
      gestureInteractions: screens.reduce((n, s) => n + s.gestures.length, 0), interactiveWidgets: interactive.length, uncoveredWidgets: interactive.filter((s) => !s.covered).length,
      existingTests: testCount,
    },
    limitations: [...limitations, 'Static scan: dynamic keys, generated code and widgets built through helper functions may be missed.'],
  };
}
