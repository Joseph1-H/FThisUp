export const WEB_CATEGORIES = ['navigation', 'form-validation', 'ui-chaos', 'network-failure', 'authentication', 'code-analysis'];
export const CATEGORIES = [
    ...WEB_CATEGORIES,
    'api',
    'cli',
    'unit-tests',
    'fuzzing',
    'build',
    'startup',
    'static-analysis',
    'project-validation',
    'autonomous-discovery',
];
/** Shared failure taxonomy used by every adapter. */
export const FAILURE_TYPES = [
    'crash',
    'unhandled-exception',
    'hang',
    'incorrect-output',
    'invalid-state-transition',
    'data-corruption',
    'input-validation',
    'resource-usage',
    'build-failure',
    'dependency-failure',
    'auth-error',
    'network-error-handling',
    'ui-interaction',
    'regression',
    'incomplete-functionality',
    'broken-navigation',
    'security-weakness',
    'layout-defect',
];
