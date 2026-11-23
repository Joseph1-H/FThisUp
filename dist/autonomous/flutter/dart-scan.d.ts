/** Minimal Dart source scanning helpers: enough structure for an application map, not a Dart parser. */
/** Blank out comments and string contents (keeping quotes and offsets) so braces/parens can be matched safely. */
export declare function mask(src: string): string;
export declare function matchClose(masked: string, openIdx: number): number;
export declare const lineOf: (src: string, idx: number) => number;
export interface Call {
    name: string;
    start: number;
    open: number;
    close: number;
    args: string;
    argsMasked: string;
}
export declare function findCalls(src: string, masked: string, names: string[]): Call[];
/** Split call arguments at top-level commas; returns named args (`name: value`) and a positional count. */
export declare function splitArgs(args: string, argsMasked: string): {
    named: Record<string, string>;
    positional: string[];
};
export declare const strLiteral: (s: string | undefined) => string | undefined;
export declare function keyOf(s: string | undefined): string | undefined;
