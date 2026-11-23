/**
 * Typed scenario → Dart widget test. The ONLY inputs that reach the generated source are
 *  (a) fixed templates in this file, (b) identifiers already validated against the app map, and
 *  (c) data that is emitted exclusively through dartString()/dartNum(). Nothing the agent wrote is ever pasted as code.
 */
const PRESETS = {
    empty: '',
    whitespace: '   \t  ',
    long: 'W'.repeat(300),
    'long-words': 'Supercalifragilisticexpialidocious '.repeat(8).trim(),
    unicode: 'Ünïcödé 日本語 العربية עברית Ελληνικά',
    emoji: '🏋️‍♂️💪🔥😀 test',
    rtl: '‮evil‬ مرحبا',
    negative: '-5',
    zero: '0',
    'huge-number': '9'.repeat(30),
    decimal: '1.5.2',
    markup: '<b>x</b>&amp;<script>alert(1)</script>',
    quote: `'"; DROP TABLE x; --`,
    newline: 'line1\nline2',
};
export function resolveText(t) {
    if (typeof t === 'string')
        return t;
    if ('preset' in t)
        return PRESETS[t.preset];
    return t.repeat.unit.repeat(t.repeat.times);
}
/** A Dart single-quoted string literal. `$` and `\` are escaped, every non-printable/ambiguous code point becomes \u{...}. */
export function dartString(s) {
    let out = "'";
    for (const ch of s) {
        const cp = ch.codePointAt(0);
        if (ch === '\\')
            out += '\\\\';
        else if (ch === "'")
            out += "\\'";
        else if (ch === '$')
            out += '\\$';
        else if (cp < 0x20 || cp === 0x7f || (cp >= 0x80 && cp < 0xa0) || (cp >= 0x2028 && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069) || cp === 0xfeff || (cp >= 0xd800 && cp <= 0xdfff))
            out += `\\u{${cp.toString(16)}}`;
        else
            out += ch;
    }
    return `${out}'`;
}
const dartNum = (n) => (Number.isFinite(n) ? (Number.isInteger(n) ? `${n}.0` : String(n)) : '0.0');
function dartArg(v) {
    if (v === null)
        return 'null';
    if (typeof v === 'string')
        return dartString(v);
    if (typeof v === 'number')
        return Number.isInteger(v) ? String(v) : String(v);
    return v ? 'true' : 'false';
}
export function finderExpr(f) {
    const v = dartString(f.value);
    const base = f.by === 'key' ? `find.byKey(const ValueKey<String>(${v}))`
        : f.by === 'text' ? `find.text(${v})`
            : f.by === 'textContaining' ? `find.textContaining(${v})`
                : f.by === 'type' ? `find.byType(${f.value})`
                    : f.by === 'tooltip' ? `find.byTooltip(${v})`
                        : `find.widgetWithText(TextField, ${v})`;
    return base;
}
const pick = (f) => `${finderExpr(f)}.at(${f.index ?? 0})`;
const desc = (f) => dartString(`${f.by} ${JSON.stringify(f.value)}${f.index ? ` #${f.index}` : ''}`);
function assertionCode(a, label) {
    const L = dartString(label);
    const d = desc(a.target);
    switch (a.kind) {
        case 'visible': return `_check(${finderExpr(a.target)}.evaluate().isNotEmpty, ${L}, 'expected ' + ${d} + ' to be present, but it is not');`;
        case 'absent': return `_check(${finderExpr(a.target)}.evaluate().isEmpty, ${L}, 'expected ' + ${d} + ' to be absent, but ' + ${finderExpr(a.target)}.evaluate().length.toString() + ' found');`;
        case 'count': {
            const n = `${finderExpr(a.target)}.evaluate().length`;
            const parts = [];
            if (a.equals !== undefined)
                parts.push(`${n} == ${a.equals}`);
            if (a.atLeast !== undefined)
                parts.push(`${n} >= ${a.atLeast}`);
            if (a.atMost !== undefined)
                parts.push(`${n} <= ${a.atMost}`);
            const want = [a.equals !== undefined ? `exactly ${a.equals}` : '', a.atLeast !== undefined ? `at least ${a.atLeast}` : '', a.atMost !== undefined ? `at most ${a.atMost}` : ''].filter(Boolean).join(' and ');
            return `_check(${parts.join(' && ')}, ${L}, 'expected ' + ${d} + ' to match ${want} widget(s), found ' + ${n}.toString());`;
        }
        case 'buttonEnabled':
            return `{ final _els = ${finderExpr(a.target)}.evaluate(); if (_els.isEmpty) { _check(false, ${L}, 'cannot check enabled state: ' + ${d} + ' is not present'); } else { _check(_enabled(_els.first.widget) == ${a.enabled}, ${L}, 'expected ' + ${d} + ' to be ${a.enabled ? 'enabled' : 'disabled'}, but it is ' + (_enabled(_els.first.widget) == null ? 'not a button' : _enabled(_els.first.widget)! ? 'enabled' : 'disabled')); } }`;
    }
}
class Emitter {
    indent;
    lines = [];
    n = 0;
    constructor(indent = '      ') {
        this.indent = indent;
    }
    emit(s) { this.lines.push(this.indent + s); }
    step(st, path) {
        const label = `${path}`;
        const L = dartString(label);
        this.n++;
        switch (st.do) {
            case 'enterText': {
                const txt = dartString(resolveText(st.text));
                this.emit(`await _need(tester, ${finderExpr(st.target)}, ${desc(st.target)}, ${L}); await _act(tester, ${L}, () async { await tester.enterText(${pick(st.target)}, ${txt}); await tester.pump(); });`);
                break;
            }
            case 'tap':
                this.emit(`await _need(tester, ${finderExpr(st.target)}, ${desc(st.target)}, ${L}); await _act(tester, ${L}, () async { await _ensure(tester, ${pick(st.target)}); await tester.tap(${pick(st.target)}, warnIfMissed: false); await tester.pump(); });`);
                break;
            case 'doubleTap':
                this.emit(`await _need(tester, ${finderExpr(st.target)}, ${desc(st.target)}, ${L}); await _act(tester, ${L}, () async { await _ensure(tester, ${pick(st.target)}); await tester.tap(${pick(st.target)}, warnIfMissed: false); await tester.pump(const Duration(milliseconds: 40)); await tester.tap(${pick(st.target)}, warnIfMissed: false); await tester.pump(); });`);
                break;
            case 'longPress':
                this.emit(`await _need(tester, ${finderExpr(st.target)}, ${desc(st.target)}, ${L}); await _act(tester, ${L}, () async { await _ensure(tester, ${pick(st.target)}); await tester.longPress(${pick(st.target)}, warnIfMissed: false); await tester.pump(); });`);
                break;
            case 'rapidTap':
                this.emit(`await _need(tester, ${finderExpr(st.target)}, ${desc(st.target)}, ${L}); await _act(tester, ${L}, () async { await _ensure(tester, ${pick(st.target)}); for (var i = 0; i < ${st.times}; i++) { if (${finderExpr(st.target)}.evaluate().isEmpty) break; await tester.tap(${pick(st.target)}, warnIfMissed: false); await tester.pump(const Duration(milliseconds: ${st.gapMs})); } });`);
                break;
            case 'drag':
                this.emit(`await _need(tester, ${finderExpr(st.target)}, ${desc(st.target)}, ${L}); await _act(tester, ${L}, () async { await tester.drag(${pick(st.target)}, Offset(${dartNum(st.dx)}, ${dartNum(st.dy)}), warnIfMissed: false); await tester.pump(); });`);
                break;
            case 'fling':
                this.emit(`await _need(tester, ${finderExpr(st.target)}, ${desc(st.target)}, ${L}); await _act(tester, ${L}, () async { await tester.fling(${pick(st.target)}, Offset(${dartNum(st.dx)}, ${dartNum(st.dy)}), 1200.0, warnIfMissed: false); await tester.pump(); });`);
                break;
            case 'scrollIntoView':
                this.emit(`await _need(tester, ${finderExpr(st.target)}, ${desc(st.target)}, ${L}); await _act(tester, ${L}, () async { await _ensure(tester, ${pick(st.target)}); });`);
                break;
            case 'pump':
                this.emit(`await _act(tester, ${L}, () async { await tester.pump(const Duration(milliseconds: ${st.ms})); });`);
                break;
            case 'settle':
                this.emit(`await _act(tester, ${L}, () async { await _settle(tester); });`);
                break;
            case 'back':
                this.emit(`await _act(tester, ${L}, () async { final nav = find.byType(Navigator); if (nav.evaluate().isEmpty) throw _Setup('no Navigator in the tree'); tester.state<NavigatorState>(nav.first).pop(); await tester.pump(); });`);
                break;
            case 'dispose':
                this.emit(`await _act(tester, ${L}, () async { await tester.pumpWidget(const SizedBox.shrink()); for (var ms = 0; ms < ${st.ms}; ms += 100) { await tester.pump(const Duration(milliseconds: 100)); } });`);
                break;
            case 'expect':
                this.emit(assertionCode(st.assert, `${label} expect ${st.assert.kind}`));
                break;
            case 'repeat': {
                this.emit(`for (var _r${this.n} = 0; _r${this.n} < ${st.times}; _r${this.n}++) {`);
                st.steps.forEach((s, i) => this.step(s, `${path}.${i + 1}`));
                this.emit('}');
                break;
            }
        }
    }
}
/** Describe steps for humans (reproduction steps in the report). */
export function humanSteps(steps, prefix = '') {
    const f = (t) => `${t.by === 'key' ? 'the widget with key' : t.by} "${t.value}"`;
    const out = [];
    steps.forEach((s, i) => {
        const n = `${prefix}${i + 1}`;
        switch (s.do) {
            case 'enterText':
                out.push(`${n}. Enter ${JSON.stringify(typeof s.text === 'string' ? (s.text.length > 40 ? `${s.text.slice(0, 40)}…` : s.text) : 'preset' in s.text ? `<${s.text.preset}>` : `<"${s.text.repeat.unit}" × ${s.text.repeat.times}>`)} into ${f(s.target)}`);
                break;
            case 'tap':
                out.push(`${n}. Tap ${f(s.target)}`);
                break;
            case 'doubleTap':
                out.push(`${n}. Double-tap ${f(s.target)}`);
                break;
            case 'longPress':
                out.push(`${n}. Long-press ${f(s.target)}`);
                break;
            case 'rapidTap':
                out.push(`${n}. Tap ${f(s.target)} ${s.times} times in quick succession`);
                break;
            case 'drag':
                out.push(`${n}. Drag ${f(s.target)} by (${s.dx}, ${s.dy})`);
                break;
            case 'fling':
                out.push(`${n}. Fling ${f(s.target)} by (${s.dx}, ${s.dy})`);
                break;
            case 'scrollIntoView':
                out.push(`${n}. Scroll ${f(s.target)} into view`);
                break;
            case 'pump':
                out.push(`${n}. Wait ${s.ms} ms`);
                break;
            case 'settle':
                out.push(`${n}. Wait until animations/timers settle`);
                break;
            case 'back':
                out.push(`${n}. Press the system Back button`);
                break;
            case 'dispose':
                out.push(`${n}. Remove the screen from the widget tree, then wait ${s.ms} ms`);
                break;
            case 'expect':
                out.push(`${n}. Check: ${s.assert.kind} ${f(s.assert.target)}`);
                break;
            case 'repeat':
                out.push(`${n}. Repeat ${s.times} times:`, ...humanSteps(s.steps, `${n}.`).map((l) => `   ${l}`));
                break;
        }
    });
    return out;
}
const HELPERS = String.raw `
class _Setup implements Exception { _Setup(this.message); final String message; @override String toString() => message; }
class _Blocked implements HttpClient {
  static final List<String> attempts = <String>[];
  @override
  dynamic noSuchMethod(Invocation i) {
    final a = i.positionalArguments;
    var host = '?';
    for (final x in a) { if (x is Uri) { host = x.host; } }
    if (a.length >= 2 && a[1] is String && a[0] is String) { host = a[1] as String; }
    attempts.add(host);
    throw const SocketException('FTHISUP_NETWORK_BLOCKED: generated tests never use the network');
  }
}
class _Overrides extends HttpOverrides { @override HttpClient createHttpClient(SecurityContext? c) => _Blocked(); }

final List<Map<String, Object?>> _observed = <Map<String, Object?>>[];
final List<Map<String, Object?>> _failed = <Map<String, Object?>>[];

void _record(String where, FlutterErrorDetails d) {
  final stack = d.stack?.toString().split('\n').where((l) => l.contains('package:') || l.contains('.dart')).take(14).toList() ?? <String>[];
  _observed.add(<String, Object?>{'where': where, 'type': d.exception.runtimeType.toString(), 'message': d.exceptionAsString().split('\n').take(8).join(' | '), 'stack': stack});
}
void _check(bool ok, String where, String message) { if (!ok) _failed.add(<String, Object?>{'where': where, 'message': message}); }
bool? _enabled(Widget w) {
  try { return (w as dynamic).onPressed != null; } catch (_) { return null; }
}
Future<void> _need(WidgetTester t, Finder f, String what, String where) async {
  if (f.evaluate().isEmpty) throw _Setup('step $where: nothing matches ' + what + ' on screen at this point');
}
Future<void> _ensure(WidgetTester t, Finder f) async {
  try { await t.ensureVisible(f); await t.pump(); } catch (_) {}
}
Future<void> _settle(WidgetTester t, {int maxMs = 5000}) async {
  var el = 0;
  await t.pump();
  while (t.binding.hasScheduledFrame && el < maxMs) { await t.pump(const Duration(milliseconds: 100)); el += 100; }
}
Future<void> _act(WidgetTester t, String where, Future<void> Function() body) async {
  try { await body(); while (t.takeException() != null) {} } on _Setup { rethrow; } on TestFailure catch (e) { throw _Setup('step $where: test API failed: ' + e.toString().split('\n').first); }
  catch (e) { if (e is FlutterError || e is AssertionError || e is StateError) { throw _Setup('step $where: test API failed: ' + e.toString().split('\n').first); } rethrow; }
}
void _emit(String status, [Object? extra]) {
  // ignore: avoid_print
  print('FTHISUP_RESULT ' + jsonEncode(<String, Object?>{'status': status, 'observed': _observed, 'failed': _failed, 'network': _Blocked.attempts, 'extra': extra}));
}
`;
export function generateDartTest(sc, cg) {
    const w = sc.screen;
    const imports = new Set();
    const needed = new Set([w.widget]);
    const walk = (steps) => { for (const s of steps) {
        if ('target' in s && s.target.by === 'type')
            needed.add(s.target.value);
        if (s.do === 'expect' && s.assert.target.by === 'type')
            needed.add(s.assert.target.value);
        if (s.do === 'repeat')
            walk(s.steps);
    } };
    walk(sc.steps);
    for (const a of sc.assertions)
        if (a.target.by === 'type')
            needed.add(a.target.value);
    for (const n of needed) {
        const f = cg.classFiles[n];
        if (f)
            imports.add(`import 'package:${cg.pkg}/${f}';`);
    }
    const argList = Object.entries(w.args).map(([k, v]) => `${k}: ${dartArg(v)}`).join(', ');
    const ctor = `${w.widget}(${argList})`;
    const home = w.wrap === 'materialApp+scaffold' ? `Scaffold(body: ${ctor})` : ctor;
    const em = new Emitter();
    sc.steps.forEach((s, i) => em.step(s, `${i + 1}`));
    const finals = sc.assertions.map((a, i) => `      ${assertionCode(a, `final check ${i + 1} (${a.kind})`)}`);
    return `// GENERATED by FThisUp. Scenario: ${sc.id}${sc.method === 'agent' ? ' (agent-generated)' : ' (engine-seeded)'}.
// Typed scenario -> Dart; no agent-written code is included. This file lives only in an isolated copy of your project.
// ignore_for_file: type=lint
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
${cg.usesSharedPreferences ? "import 'package:shared_preferences/shared_preferences.dart';\n" : ''}${[...imports].join('\n')}
${HELPERS}
void main() {
  testWidgets(${dartString(`FTHISUP::${sc.id}`)}, (tester) async {
    HttpOverrides.global = _Overrides();
    tester.view.physicalSize = const Size(${dartNum(w.viewport.width)}, ${dartNum(w.viewport.height)});
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    ${cg.usesSharedPreferences ? 'SharedPreferences.setMockInitialValues(<String, Object>{});' : ''}
    final prev = FlutterError.onError;
    var phase = 'baseline';
    FlutterError.onError = (FlutterErrorDetails d) { _record(phase, d); prev?.call(d); };
    var status = 'ok';
    Object? extra;
    try {
      await tester.pumpWidget(MaterialApp(home: ${home}));
      await _settle(tester);
      while (tester.takeException() != null) {}
      if (_observed.isNotEmpty) { status = 'baseline'; }
      else {
        phase = 'steps';
${em.lines.join('\n')}
        phase = 'checks';
${finals.join('\n')}
        while (tester.takeException() != null) {}
        if (_observed.isNotEmpty || _failed.isNotEmpty) status = 'failed';
      }
    } on _Setup catch (e) {
      status = 'setup'; extra = e.message;
    } finally {
      FlutterError.onError = prev;
      HttpOverrides.global = null;
    }
    _emit(status, extra);
  });
}
`;
}
