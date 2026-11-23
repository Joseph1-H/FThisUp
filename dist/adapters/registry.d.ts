import type { TestAdapter } from './types.js';
/** Order matters only for report ordering and finding ids. New adapters are registered here; nothing else hardcodes them. */
export declare const ADAPTERS: TestAdapter[];
export declare function adapterById(id: string): TestAdapter | undefined;
