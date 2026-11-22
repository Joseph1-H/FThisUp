import { z } from 'zod';
import { CATEGORIES } from '../core/types.js';

/**
 * The ONLY things a scenario can make the executor do. There is no "evaluate",
 * "shell", or "raw script" action. Anything an AI proposes must fit this schema.
 */
const o = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();
const selector = z.string().min(1).max(300);
const relPath = z.string().min(1).max(500);

export const actionSchema = z.discriminatedUnion('action', [
  o({ action: z.literal('goto'), path: relPath }),
  o({ action: z.literal('click'), selector }),
  o({ action: z.literal('repeatClick'), selector, times: z.number().int().min(2).max(10), delayMs: z.number().int().min(0).max(1000).default(0) }),
  o({ action: z.literal('fill'), selector, value: z.string().max(20000) }),
  o({ action: z.literal('fillAll'), scope: selector.optional(), kind: z.enum(['valid', 'long', 'special', 'unicode', 'xss-marker', 'invalid-email', 'invalid-number', 'empty']) }),
  o({ action: z.literal('submit'), selector }),
  o({ action: z.literal('press'), key: z.enum(['Enter', 'Escape', 'Tab', 'ArrowDown', 'ArrowUp']) }),
  o({ action: z.literal('reload') }),
  o({ action: z.literal('goBack') }),
  o({ action: z.literal('goForward') }),
  o({ action: z.literal('setViewport'), width: z.number().int().min(200).max(3840), height: z.number().int().min(200).max(2160) }),
  o({ action: z.literal('setNetwork'), mode: z.enum(['offline', 'http500', 'http429', 'slow', 'timeout']), delayMs: z.number().int().min(0).max(8000).optional() }),
  o({ action: z.literal('clearNetwork') }),
  o({ action: z.literal('wait'), ms: z.number().int().min(0).max(5000) }),
  o({ action: z.literal('login') }),
  o({ action: z.literal('logout') }),
  o({ action: z.literal('expireSession') }),
  o({ action: z.literal('loginWithBadPassword') }),
]);
export type Action = z.infer<typeof actionSchema>;

export const expectationSchema = z.discriminatedUnion('type', [
  o({ type: z.literal('noUncaughtExceptions') }),
  o({ type: z.literal('noBlankPage') }),
  o({ type: z.literal('pageStatusOk'), hard: z.boolean().default(true) }),
  o({ type: z.literal('noRedirectLoop') }),
  o({ type: z.literal('noMissingResources') }),
  o({ type: z.literal('noServerErrors') }),
  o({ type: z.literal('noHorizontalOverflow') }),
  o({ type: z.literal('noScriptInjection') }),
  o({ type: z.literal('noUnexpectedAuthRedirect') }),
  o({ type: z.literal('maxMutatingRequests'), max: z.number().int().min(0).max(10) }),
  o({ type: z.literal('noRequestWhenInvalid'), hard: z.boolean().default(true) }),
  o({ type: z.literal('visibleFeedbackOnFailure') }),
  o({ type: z.literal('stillInteractive') }),
  o({ type: z.literal('urlNotMatches'), pattern: z.string().max(200) }),
  o({ type: z.literal('gatedContent'), loginPathPattern: z.string().max(200).default('login|signin|sign-in|auth'), hard: z.boolean().default(true) }),
  o({ type: z.literal('selectorNotVisible'), selector }),
  o({ type: z.literal('selectorVisible'), selector }),
  o({ type: z.literal('loginFormVisible') }),
]);
export type Expectation = z.infer<typeof expectationSchema>;

export const scenarioSchema = o({
  id: z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,120}$/i, 'id must be alphanumeric with . _ : -'),
  name: z.string().min(1).max(200),
  category: z.enum(CATEGORIES),
  risk: z.enum(['low', 'medium', 'high']),
  target: relPath,
  steps: z.array(actionSchema).max(40),
  expected: z.array(expectationSchema).min(1).max(20),
  requiresApproval: z.boolean().default(false),
  /** set by the generator for scenarios that depend on a specific kind of approval */
  sensitivity: z.enum(['deletion', 'purchase', 'account-creation', 'messaging', 'upload', 'irreversible']).optional(),
  /** Human-readable explanation of what is expected (shown in reports). */
  description: z.string().max(500).optional(),
  /** What the scenario targets in the page, for repro text. */
  component: z.string().max(200).optional(),
  /** Where the scenario came from; used for honesty in reports. */
  origin: z.enum(['heuristic', 'agent']).default('heuristic'),
});
export type Scenario = z.infer<typeof scenarioSchema>;

export const scenarioFileSchema = z.object({ scenarios: z.array(z.unknown()) });
