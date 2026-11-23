import type { Finder, FlutterScenario, Step, TextValue } from './schema.js';
export declare function resolveText(t: TextValue): string;
/** A Dart single-quoted string literal. `$` and `\` are escaped, every non-printable/ambiguous code point becomes \u{...}. */
export declare function dartString(s: string): string;
export declare function finderExpr(f: Finder): string;
/** Describe steps for humans (reproduction steps in the report). */
export declare function humanSteps(steps: Step[], prefix?: string): string[];
export interface CodegenContext {
    pkg: string;
    /** class name → path relative to lib/ (e.g. "workout_screen.dart") for every widget class the scenario may reference */
    classFiles: Record<string, string>;
    usesSharedPreferences: boolean;
}
export declare function generateDartTest(sc: FlutterScenario, cg: CodegenContext): string;
