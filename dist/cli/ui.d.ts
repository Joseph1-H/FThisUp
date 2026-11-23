export declare const c: {
    red: (s: string) => string;
    green: (s: string) => string;
    yellow: (s: string) => string;
    dim: (s: string) => string;
    bold: (s: string) => string;
    gray: (s: string) => string;
    cyan: (s: string) => string;
};
export declare const BANNER: string;
export declare function printBanner(target?: string): void;
export declare const tag: {
    pass: () => string;
    fail: () => string;
    warn: () => string;
    skip: () => string;
    info: () => string;
};
export declare const CATEGORY_LABEL: Record<string, string>;
export declare function progressLine(i: number, total: number, name: string, outcome: string): void;
export declare function clearProgress(): void;
