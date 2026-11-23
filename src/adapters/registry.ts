import type { TestAdapter } from './types.js';
import { webAdapter } from './web.js';
import { apiAdapter } from './api.js';
import { cliAdapter } from './cli.js';
import { desktopAdapter } from './desktop.js';
import { godotAdapter } from './godot.js';
import { cppAdapter, flutterAdapter, goAdapter, javaAdapter, javascriptAdapter, pythonAdapter, rustAdapter, swiftAdapter } from './runners.js';

/** Order matters only for report ordering and finding ids. New adapters are registered here; nothing else hardcodes them. */
export const ADAPTERS: TestAdapter[] = [webAdapter, apiAdapter, cliAdapter, pythonAdapter, javascriptAdapter, flutterAdapter, rustAdapter, goAdapter, javaAdapter, cppAdapter, swiftAdapter, desktopAdapter, godotAdapter];

export function adapterById(id: string): TestAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id);
}
