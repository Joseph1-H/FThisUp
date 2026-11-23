/** Probe loopback only. Never scans any other host. */
export declare function detectLocalUrl(preferred?: number, accept?: (port: number) => boolean): Promise<string | null>;
