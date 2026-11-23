import type { TestAdapter } from './types.js';
import { webAdapter } from './web.js';
import { cppAdapter, flutterAdapter, goAdapter, javaAdapter, javascriptAdapter, pythonAdapter, rustAdapter, swiftAdapter } from './runners.js';

/** Order matters only for report ordering and finding ids. New adapters are registered here; nothing else hardcodes them. */
export const ADAPTERS: TestAdapter[] = [webAdapter, pythonAdapter, javascriptAdapter, flutterAdapter, rustAdapter, goAdapter, javaAdapter, cppAdapter, swiftAdapter];

export function adapterById(id: string): TestAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id);
}
