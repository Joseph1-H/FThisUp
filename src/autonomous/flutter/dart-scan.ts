/** Minimal Dart source scanning helpers: enough structure for an application map, not a Dart parser. */

/** Blank out comments and string contents (keeping quotes and offsets) so braces/parens can be matched safely. */
export function mask(src: string): string {
  const out: string[] = [];
  let i = 0;
  const n = src.length;
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  while (i < n) {
    const c = src[i]!;
    const d = src[i + 1];
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); const end = e === -1 ? n : e; out.push(blank(src.slice(i, end))); i = end; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e === -1 ? n : e + 2; out.push(blank(src.slice(i, end))); i = end; continue; }
    if (c === "'" || c === '"') {
      const raw = i > 0 && src[i - 1] === 'r';
      const triple = src.startsWith(c.repeat(3), i);
      const q = triple ? c.repeat(3) : c;
      let j = i + q.length;
      while (j < n) {
        if (!raw && src[j] === '\\') { j += 2; continue; }
        if (src.startsWith(q, j)) break;
        if (!triple && src[j] === '\n') break;
        j++;
      }
      const end = Math.min(n, j + q.length);
      out.push(q + blank(src.slice(i + q.length, Math.max(i + q.length, end - q.length))) + (end - i >= 2 * q.length ? q : ''));
      i = end;
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join('');
}

export function matchClose(masked: string, openIdx: number): number {
  const open = masked[openIdx]!;
  const close = open === '(' ? ')' : open === '{' ? '}' : ']';
  let depth = 0;
  for (let i = openIdx; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

export const lineOf = (src: string, idx: number) => src.slice(0, idx).split('\n').length;

export interface Call { name: string; start: number; open: number; close: number; args: string; argsMasked: string }

export function findCalls(src: string, masked: string, names: string[]): Call[] {
  const re = new RegExp(`(?<![\\w.])(${names.join('|')})(?:\\.\\w+)?\\s*(?:<[^>()]*>)?\\(`, 'g');
  const out: Call[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked))) {
    const open = m.index + m[0].length - 1;
    const close = matchClose(masked, open);
    if (close < 0) continue;
    out.push({ name: m[1]!, start: m.index, open, close, args: src.slice(open + 1, close), argsMasked: masked.slice(open + 1, close) });
  }
  return out;
}

/** Split call arguments at top-level commas; returns named args (`name: value`) and a positional count. */
export function splitArgs(args: string, argsMasked: string): { named: Record<string, string>; positional: string[] } {
  const parts: string[] = [];
  let depth = 0, last = 0;
  for (let i = 0; i < argsMasked.length; i++) {
    const ch = argsMasked[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) { parts.push(args.slice(last, i)); last = i + 1; }
  }
  if (args.slice(last).trim()) parts.push(args.slice(last));
  const named: Record<string, string> = {};
  const positional: string[] = [];
  for (const p of parts) {
    const m = /^\s*(\w+)\s*:(?!:)\s*([\s\S]*)$/.exec(p);
    if (m) named[m[1]!] = m[2]!.trim(); else if (p.trim()) positional.push(p.trim());
  }
  return { named, positional };
}

export const strLiteral = (s: string | undefined): string | undefined => {
  if (!s) return undefined;
  const m = /^\s*(?:const\s+)?(?:Text\(\s*)?r?(['"])((?:\\.|(?!\1)[^\\\n])*)\1/.exec(s);
  return m ? m[2]!.replace(/\\(['"$\\])/g, '$1') : undefined;
};

export function keyOf(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = /^\s*(?:const\s+)?(?:Key|ValueKey(?:<\s*String\s*>)?)\(\s*(['"])((?:\\.|(?!\1)[^\\\n])*)\1\s*\)/.exec(s);
  return m ? m[2] : undefined;
}
