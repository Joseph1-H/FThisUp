const EMAIL = /[A-Za-z0-9._%+-]+@(?!example\.invalid\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const KV = /(["']?(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|session(?:id)?|csrf)["']?\s*[:=]\s*)(["']?)[^"'&\s,}]{1,200}/gi;
const QUERY = /([?&](?:token|key|api_key|apikey|access_token|password|secret|code|sid|session)=)[^&#\s]+/gi;
const CARD = /\b(?:\d[ -]?){13,19}\b/g;
const LONG_TOKEN = /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g;

const MAX_STRING = 600;

function luhn(d: string): boolean {
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}

export function redactString(input: string, secrets: string[] = []): string {
  let s = input;
  for (const secret of secrets) if (secret && secret.length >= 3) s = s.split(secret).join('[REDACTED]');
  s = s.replace(JWT, '[REDACTED-JWT]')
    .replace(BEARER, '$1 [REDACTED]')
    .replace(KV, '$1$2[REDACTED]')
    .replace(QUERY, '$1[REDACTED]')
    .replace(EMAIL, '[REDACTED-EMAIL]')
    .replace(CARD, (m) => (luhn(m.replace(/\D/g, '')) ? '[REDACTED-NUMBER]' : m))
    .replace(LONG_TOKEN, '[REDACTED-TOKEN]');
  if (s.length > MAX_STRING) s = `${s.slice(0, MAX_STRING)}… [truncated ${s.length - MAX_STRING} chars]`;
  return s;
}

/** Deep-redact every string in a JSON-able value. Applied to ALL data before it is written to disk. */
export function redactDeep<T>(value: T, secrets: string[] = []): T {
  if (typeof value === 'string') return redactString(value, secrets) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, secrets)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactDeep(v, secrets);
    return out as T;
  }
  return value;
}
