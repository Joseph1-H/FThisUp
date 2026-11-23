export declare function redactString(input: string, secrets?: string[]): string;
/** Deep-redact every string in a JSON-able value. Applied to ALL data before it is written to disk. */
export declare function redactDeep<T>(value: T, secrets?: string[]): T;
