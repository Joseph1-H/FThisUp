import { z } from 'zod';
export declare const actionSchema: z.ZodDiscriminatedUnion<"action", [z.ZodObject<{
    action: z.ZodLiteral<"goto">;
    path: z.ZodString;
}, "strict", z.ZodTypeAny, {
    path: string;
    action: "goto";
}, {
    path: string;
    action: "goto";
}>, z.ZodObject<{
    action: z.ZodLiteral<"click">;
    selector: z.ZodString;
}, "strict", z.ZodTypeAny, {
    action: "click";
    selector: string;
}, {
    action: "click";
    selector: string;
}>, z.ZodObject<{
    action: z.ZodLiteral<"repeatClick">;
    selector: z.ZodString;
    times: z.ZodNumber;
    delayMs: z.ZodDefault<z.ZodNumber>;
}, "strict", z.ZodTypeAny, {
    action: "repeatClick";
    selector: string;
    times: number;
    delayMs: number;
}, {
    action: "repeatClick";
    selector: string;
    times: number;
    delayMs?: number | undefined;
}>, z.ZodObject<{
    action: z.ZodLiteral<"fill">;
    selector: z.ZodString;
    value: z.ZodString;
}, "strict", z.ZodTypeAny, {
    value: string;
    action: "fill";
    selector: string;
}, {
    value: string;
    action: "fill";
    selector: string;
}>, z.ZodObject<{
    action: z.ZodLiteral<"fillAll">;
    scope: z.ZodOptional<z.ZodString>;
    kind: z.ZodEnum<["valid", "long", "special", "unicode", "xss-marker", "invalid-email", "invalid-number", "empty"]>;
}, "strict", z.ZodTypeAny, {
    action: "fillAll";
    kind: "valid" | "long" | "special" | "unicode" | "xss-marker" | "invalid-email" | "invalid-number" | "empty";
    scope?: string | undefined;
}, {
    action: "fillAll";
    kind: "valid" | "long" | "special" | "unicode" | "xss-marker" | "invalid-email" | "invalid-number" | "empty";
    scope?: string | undefined;
}>, z.ZodObject<{
    action: z.ZodLiteral<"submit">;
    selector: z.ZodString;
}, "strict", z.ZodTypeAny, {
    action: "submit";
    selector: string;
}, {
    action: "submit";
    selector: string;
}>, z.ZodObject<{
    action: z.ZodLiteral<"press">;
    key: z.ZodEnum<["Enter", "Escape", "Tab", "ArrowDown", "ArrowUp"]>;
}, "strict", z.ZodTypeAny, {
    action: "press";
    key: "Enter" | "Escape" | "Tab" | "ArrowDown" | "ArrowUp";
}, {
    action: "press";
    key: "Enter" | "Escape" | "Tab" | "ArrowDown" | "ArrowUp";
}>, z.ZodObject<{
    action: z.ZodLiteral<"reload">;
}, "strict", z.ZodTypeAny, {
    action: "reload";
}, {
    action: "reload";
}>, z.ZodObject<{
    action: z.ZodLiteral<"goBack">;
}, "strict", z.ZodTypeAny, {
    action: "goBack";
}, {
    action: "goBack";
}>, z.ZodObject<{
    action: z.ZodLiteral<"goForward">;
}, "strict", z.ZodTypeAny, {
    action: "goForward";
}, {
    action: "goForward";
}>, z.ZodObject<{
    action: z.ZodLiteral<"setViewport">;
    width: z.ZodNumber;
    height: z.ZodNumber;
}, "strict", z.ZodTypeAny, {
    action: "setViewport";
    width: number;
    height: number;
}, {
    action: "setViewport";
    width: number;
    height: number;
}>, z.ZodObject<{
    action: z.ZodLiteral<"setNetwork">;
    mode: z.ZodEnum<["offline", "http500", "http429", "slow", "timeout"]>;
    delayMs: z.ZodOptional<z.ZodNumber>;
}, "strict", z.ZodTypeAny, {
    mode: "timeout" | "offline" | "http500" | "http429" | "slow";
    action: "setNetwork";
    delayMs?: number | undefined;
}, {
    mode: "timeout" | "offline" | "http500" | "http429" | "slow";
    action: "setNetwork";
    delayMs?: number | undefined;
}>, z.ZodObject<{
    action: z.ZodLiteral<"clearNetwork">;
}, "strict", z.ZodTypeAny, {
    action: "clearNetwork";
}, {
    action: "clearNetwork";
}>, z.ZodObject<{
    action: z.ZodLiteral<"wait">;
    ms: z.ZodNumber;
}, "strict", z.ZodTypeAny, {
    action: "wait";
    ms: number;
}, {
    action: "wait";
    ms: number;
}>, z.ZodObject<{
    action: z.ZodLiteral<"login">;
}, "strict", z.ZodTypeAny, {
    action: "login";
}, {
    action: "login";
}>, z.ZodObject<{
    action: z.ZodLiteral<"logout">;
}, "strict", z.ZodTypeAny, {
    action: "logout";
}, {
    action: "logout";
}>, z.ZodObject<{
    action: z.ZodLiteral<"expireSession">;
}, "strict", z.ZodTypeAny, {
    action: "expireSession";
}, {
    action: "expireSession";
}>, z.ZodObject<{
    action: z.ZodLiteral<"loginWithBadPassword">;
}, "strict", z.ZodTypeAny, {
    action: "loginWithBadPassword";
}, {
    action: "loginWithBadPassword";
}>]>;
export type Action = z.infer<typeof actionSchema>;
export declare const expectationSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"noUncaughtExceptions">;
}, "strict", z.ZodTypeAny, {
    type: "noUncaughtExceptions";
}, {
    type: "noUncaughtExceptions";
}>, z.ZodObject<{
    type: z.ZodLiteral<"noBlankPage">;
}, "strict", z.ZodTypeAny, {
    type: "noBlankPage";
}, {
    type: "noBlankPage";
}>, z.ZodObject<{
    type: z.ZodLiteral<"pageStatusOk">;
    hard: z.ZodDefault<z.ZodBoolean>;
}, "strict", z.ZodTypeAny, {
    type: "pageStatusOk";
    hard: boolean;
}, {
    type: "pageStatusOk";
    hard?: boolean | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"noRedirectLoop">;
}, "strict", z.ZodTypeAny, {
    type: "noRedirectLoop";
}, {
    type: "noRedirectLoop";
}>, z.ZodObject<{
    type: z.ZodLiteral<"noMissingResources">;
}, "strict", z.ZodTypeAny, {
    type: "noMissingResources";
}, {
    type: "noMissingResources";
}>, z.ZodObject<{
    type: z.ZodLiteral<"noServerErrors">;
}, "strict", z.ZodTypeAny, {
    type: "noServerErrors";
}, {
    type: "noServerErrors";
}>, z.ZodObject<{
    type: z.ZodLiteral<"noHorizontalOverflow">;
}, "strict", z.ZodTypeAny, {
    type: "noHorizontalOverflow";
}, {
    type: "noHorizontalOverflow";
}>, z.ZodObject<{
    type: z.ZodLiteral<"noScriptInjection">;
}, "strict", z.ZodTypeAny, {
    type: "noScriptInjection";
}, {
    type: "noScriptInjection";
}>, z.ZodObject<{
    type: z.ZodLiteral<"noUnexpectedAuthRedirect">;
}, "strict", z.ZodTypeAny, {
    type: "noUnexpectedAuthRedirect";
}, {
    type: "noUnexpectedAuthRedirect";
}>, z.ZodObject<{
    type: z.ZodLiteral<"maxMutatingRequests">;
    max: z.ZodNumber;
}, "strict", z.ZodTypeAny, {
    type: "maxMutatingRequests";
    max: number;
}, {
    type: "maxMutatingRequests";
    max: number;
}>, z.ZodObject<{
    type: z.ZodLiteral<"noRequestWhenInvalid">;
    hard: z.ZodDefault<z.ZodBoolean>;
}, "strict", z.ZodTypeAny, {
    type: "noRequestWhenInvalid";
    hard: boolean;
}, {
    type: "noRequestWhenInvalid";
    hard?: boolean | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"visibleFeedbackOnFailure">;
}, "strict", z.ZodTypeAny, {
    type: "visibleFeedbackOnFailure";
}, {
    type: "visibleFeedbackOnFailure";
}>, z.ZodObject<{
    type: z.ZodLiteral<"stillInteractive">;
}, "strict", z.ZodTypeAny, {
    type: "stillInteractive";
}, {
    type: "stillInteractive";
}>, z.ZodObject<{
    type: z.ZodLiteral<"urlNotMatches">;
    pattern: z.ZodString;
}, "strict", z.ZodTypeAny, {
    type: "urlNotMatches";
    pattern: string;
}, {
    type: "urlNotMatches";
    pattern: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"gatedContent">;
    loginPathPattern: z.ZodDefault<z.ZodString>;
    hard: z.ZodDefault<z.ZodBoolean>;
}, "strict", z.ZodTypeAny, {
    type: "gatedContent";
    hard: boolean;
    loginPathPattern: string;
}, {
    type: "gatedContent";
    hard?: boolean | undefined;
    loginPathPattern?: string | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"selectorNotVisible">;
    selector: z.ZodString;
}, "strict", z.ZodTypeAny, {
    type: "selectorNotVisible";
    selector: string;
}, {
    type: "selectorNotVisible";
    selector: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"selectorVisible">;
    selector: z.ZodString;
}, "strict", z.ZodTypeAny, {
    type: "selectorVisible";
    selector: string;
}, {
    type: "selectorVisible";
    selector: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"loginFormVisible">;
}, "strict", z.ZodTypeAny, {
    type: "loginFormVisible";
}, {
    type: "loginFormVisible";
}>]>;
export type Expectation = z.infer<typeof expectationSchema>;
export declare const scenarioSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    category: z.ZodEnum<["navigation", "form-validation", "ui-chaos", "network-failure", "authentication", "code-analysis"]>;
    risk: z.ZodEnum<["low", "medium", "high"]>;
    target: z.ZodString;
    steps: z.ZodArray<z.ZodDiscriminatedUnion<"action", [z.ZodObject<{
        action: z.ZodLiteral<"goto">;
        path: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        path: string;
        action: "goto";
    }, {
        path: string;
        action: "goto";
    }>, z.ZodObject<{
        action: z.ZodLiteral<"click">;
        selector: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        action: "click";
        selector: string;
    }, {
        action: "click";
        selector: string;
    }>, z.ZodObject<{
        action: z.ZodLiteral<"repeatClick">;
        selector: z.ZodString;
        times: z.ZodNumber;
        delayMs: z.ZodDefault<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        action: "repeatClick";
        selector: string;
        times: number;
        delayMs: number;
    }, {
        action: "repeatClick";
        selector: string;
        times: number;
        delayMs?: number | undefined;
    }>, z.ZodObject<{
        action: z.ZodLiteral<"fill">;
        selector: z.ZodString;
        value: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        value: string;
        action: "fill";
        selector: string;
    }, {
        value: string;
        action: "fill";
        selector: string;
    }>, z.ZodObject<{
        action: z.ZodLiteral<"fillAll">;
        scope: z.ZodOptional<z.ZodString>;
        kind: z.ZodEnum<["valid", "long", "special", "unicode", "xss-marker", "invalid-email", "invalid-number", "empty"]>;
    }, "strict", z.ZodTypeAny, {
        action: "fillAll";
        kind: "valid" | "long" | "special" | "unicode" | "xss-marker" | "invalid-email" | "invalid-number" | "empty";
        scope?: string | undefined;
    }, {
        action: "fillAll";
        kind: "valid" | "long" | "special" | "unicode" | "xss-marker" | "invalid-email" | "invalid-number" | "empty";
        scope?: string | undefined;
    }>, z.ZodObject<{
        action: z.ZodLiteral<"submit">;
        selector: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        action: "submit";
        selector: string;
    }, {
        action: "submit";
        selector: string;
    }>, z.ZodObject<{
        action: z.ZodLiteral<"press">;
        key: z.ZodEnum<["Enter", "Escape", "Tab", "ArrowDown", "ArrowUp"]>;
    }, "strict", z.ZodTypeAny, {
        action: "press";
        key: "Enter" | "Escape" | "Tab" | "ArrowDown" | "ArrowUp";
    }, {
        action: "press";
        key: "Enter" | "Escape" | "Tab" | "ArrowDown" | "ArrowUp";
    }>, z.ZodObject<{
        action: z.ZodLiteral<"reload">;
    }, "strict", z.ZodTypeAny, {
        action: "reload";
    }, {
        action: "reload";
    }>, z.ZodObject<{
        action: z.ZodLiteral<"goBack">;
    }, "strict", z.ZodTypeAny, {
        action: "goBack";
    }, {
        action: "goBack";
    }>, z.ZodObject<{
        action: z.ZodLiteral<"goForward">;
    }, "strict", z.ZodTypeAny, {
        action: "goForward";
    }, {
        action: "goForward";
    }>, z.ZodObject<{
        action: z.ZodLiteral<"setViewport">;
        width: z.ZodNumber;
        height: z.ZodNumber;
    }, "strict", z.ZodTypeAny, {
        action: "setViewport";
        width: number;
        height: number;
    }, {
        action: "setViewport";
        width: number;
        height: number;
    }>, z.ZodObject<{
        action: z.ZodLiteral<"setNetwork">;
        mode: z.ZodEnum<["offline", "http500", "http429", "slow", "timeout"]>;
        delayMs: z.ZodOptional<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        mode: "timeout" | "offline" | "http500" | "http429" | "slow";
        action: "setNetwork";
        delayMs?: number | undefined;
    }, {
        mode: "timeout" | "offline" | "http500" | "http429" | "slow";
        action: "setNetwork";
        delayMs?: number | undefined;
    }>, z.ZodObject<{
        action: z.ZodLiteral<"clearNetwork">;
    }, "strict", z.ZodTypeAny, {
        action: "clearNetwork";
    }, {
        action: "clearNetwork";
    }>, z.ZodObject<{
        action: z.ZodLiteral<"wait">;
        ms: z.ZodNumber;
    }, "strict", z.ZodTypeAny, {
        action: "wait";
        ms: number;
    }, {
        action: "wait";
        ms: number;
    }>, z.ZodObject<{
        action: z.ZodLiteral<"login">;
    }, "strict", z.ZodTypeAny, {
        action: "login";
    }, {
        action: "login";
    }>, z.ZodObject<{
        action: z.ZodLiteral<"logout">;
    }, "strict", z.ZodTypeAny, {
        action: "logout";
    }, {
        action: "logout";
    }>, z.ZodObject<{
        action: z.ZodLiteral<"expireSession">;
    }, "strict", z.ZodTypeAny, {
        action: "expireSession";
    }, {
        action: "expireSession";
    }>, z.ZodObject<{
        action: z.ZodLiteral<"loginWithBadPassword">;
    }, "strict", z.ZodTypeAny, {
        action: "loginWithBadPassword";
    }, {
        action: "loginWithBadPassword";
    }>]>, "many">;
    expected: z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"noUncaughtExceptions">;
    }, "strict", z.ZodTypeAny, {
        type: "noUncaughtExceptions";
    }, {
        type: "noUncaughtExceptions";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"noBlankPage">;
    }, "strict", z.ZodTypeAny, {
        type: "noBlankPage";
    }, {
        type: "noBlankPage";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"pageStatusOk">;
        hard: z.ZodDefault<z.ZodBoolean>;
    }, "strict", z.ZodTypeAny, {
        type: "pageStatusOk";
        hard: boolean;
    }, {
        type: "pageStatusOk";
        hard?: boolean | undefined;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"noRedirectLoop">;
    }, "strict", z.ZodTypeAny, {
        type: "noRedirectLoop";
    }, {
        type: "noRedirectLoop";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"noMissingResources">;
    }, "strict", z.ZodTypeAny, {
        type: "noMissingResources";
    }, {
        type: "noMissingResources";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"noServerErrors">;
    }, "strict", z.ZodTypeAny, {
        type: "noServerErrors";
    }, {
        type: "noServerErrors";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"noHorizontalOverflow">;
    }, "strict", z.ZodTypeAny, {
        type: "noHorizontalOverflow";
    }, {
        type: "noHorizontalOverflow";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"noScriptInjection">;
    }, "strict", z.ZodTypeAny, {
        type: "noScriptInjection";
    }, {
        type: "noScriptInjection";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"noUnexpectedAuthRedirect">;
    }, "strict", z.ZodTypeAny, {
        type: "noUnexpectedAuthRedirect";
    }, {
        type: "noUnexpectedAuthRedirect";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"maxMutatingRequests">;
        max: z.ZodNumber;
    }, "strict", z.ZodTypeAny, {
        type: "maxMutatingRequests";
        max: number;
    }, {
        type: "maxMutatingRequests";
        max: number;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"noRequestWhenInvalid">;
        hard: z.ZodDefault<z.ZodBoolean>;
    }, "strict", z.ZodTypeAny, {
        type: "noRequestWhenInvalid";
        hard: boolean;
    }, {
        type: "noRequestWhenInvalid";
        hard?: boolean | undefined;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"visibleFeedbackOnFailure">;
    }, "strict", z.ZodTypeAny, {
        type: "visibleFeedbackOnFailure";
    }, {
        type: "visibleFeedbackOnFailure";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"stillInteractive">;
    }, "strict", z.ZodTypeAny, {
        type: "stillInteractive";
    }, {
        type: "stillInteractive";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"urlNotMatches">;
        pattern: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        type: "urlNotMatches";
        pattern: string;
    }, {
        type: "urlNotMatches";
        pattern: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"gatedContent">;
        loginPathPattern: z.ZodDefault<z.ZodString>;
        hard: z.ZodDefault<z.ZodBoolean>;
    }, "strict", z.ZodTypeAny, {
        type: "gatedContent";
        hard: boolean;
        loginPathPattern: string;
    }, {
        type: "gatedContent";
        hard?: boolean | undefined;
        loginPathPattern?: string | undefined;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"selectorNotVisible">;
        selector: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        type: "selectorNotVisible";
        selector: string;
    }, {
        type: "selectorNotVisible";
        selector: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"selectorVisible">;
        selector: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        type: "selectorVisible";
        selector: string;
    }, {
        type: "selectorVisible";
        selector: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"loginFormVisible">;
    }, "strict", z.ZodTypeAny, {
        type: "loginFormVisible";
    }, {
        type: "loginFormVisible";
    }>]>, "many">;
    requiresApproval: z.ZodDefault<z.ZodBoolean>;
    /** set by the generator for scenarios that depend on a specific kind of approval */
    sensitivity: z.ZodOptional<z.ZodEnum<["deletion", "purchase", "account-creation", "messaging", "upload", "irreversible"]>>;
    /** Human-readable explanation of what is expected (shown in reports). */
    description: z.ZodOptional<z.ZodString>;
    /** What the scenario targets in the page, for repro text. */
    component: z.ZodOptional<z.ZodString>;
    /** Where the scenario came from; used for honesty in reports. */
    origin: z.ZodDefault<z.ZodEnum<["heuristic", "agent"]>>;
}, "strict", z.ZodTypeAny, {
    expected: ({
        type: "noUncaughtExceptions";
    } | {
        type: "noBlankPage";
    } | {
        type: "pageStatusOk";
        hard: boolean;
    } | {
        type: "noRedirectLoop";
    } | {
        type: "noMissingResources";
    } | {
        type: "noServerErrors";
    } | {
        type: "noHorizontalOverflow";
    } | {
        type: "noScriptInjection";
    } | {
        type: "noUnexpectedAuthRedirect";
    } | {
        type: "maxMutatingRequests";
        max: number;
    } | {
        type: "noRequestWhenInvalid";
        hard: boolean;
    } | {
        type: "visibleFeedbackOnFailure";
    } | {
        type: "stillInteractive";
    } | {
        type: "urlNotMatches";
        pattern: string;
    } | {
        type: "gatedContent";
        hard: boolean;
        loginPathPattern: string;
    } | {
        type: "selectorNotVisible";
        selector: string;
    } | {
        type: "selectorVisible";
        selector: string;
    } | {
        type: "loginFormVisible";
    })[];
    name: string;
    id: string;
    category: "navigation" | "form-validation" | "ui-chaos" | "network-failure" | "authentication" | "code-analysis";
    risk: "high" | "medium" | "low";
    target: string;
    steps: ({
        path: string;
        action: "goto";
    } | {
        action: "click";
        selector: string;
    } | {
        action: "repeatClick";
        selector: string;
        times: number;
        delayMs: number;
    } | {
        value: string;
        action: "fill";
        selector: string;
    } | {
        action: "fillAll";
        kind: "valid" | "long" | "special" | "unicode" | "xss-marker" | "invalid-email" | "invalid-number" | "empty";
        scope?: string | undefined;
    } | {
        action: "submit";
        selector: string;
    } | {
        action: "press";
        key: "Enter" | "Escape" | "Tab" | "ArrowDown" | "ArrowUp";
    } | {
        action: "reload";
    } | {
        action: "goBack";
    } | {
        action: "goForward";
    } | {
        action: "setViewport";
        width: number;
        height: number;
    } | {
        mode: "timeout" | "offline" | "http500" | "http429" | "slow";
        action: "setNetwork";
        delayMs?: number | undefined;
    } | {
        action: "clearNetwork";
    } | {
        action: "wait";
        ms: number;
    } | {
        action: "login";
    } | {
        action: "logout";
    } | {
        action: "expireSession";
    } | {
        action: "loginWithBadPassword";
    })[];
    requiresApproval: boolean;
    origin: "heuristic" | "agent";
    sensitivity?: "deletion" | "purchase" | "account-creation" | "messaging" | "upload" | "irreversible" | undefined;
    description?: string | undefined;
    component?: string | undefined;
}, {
    expected: ({
        type: "noUncaughtExceptions";
    } | {
        type: "noBlankPage";
    } | {
        type: "pageStatusOk";
        hard?: boolean | undefined;
    } | {
        type: "noRedirectLoop";
    } | {
        type: "noMissingResources";
    } | {
        type: "noServerErrors";
    } | {
        type: "noHorizontalOverflow";
    } | {
        type: "noScriptInjection";
    } | {
        type: "noUnexpectedAuthRedirect";
    } | {
        type: "maxMutatingRequests";
        max: number;
    } | {
        type: "noRequestWhenInvalid";
        hard?: boolean | undefined;
    } | {
        type: "visibleFeedbackOnFailure";
    } | {
        type: "stillInteractive";
    } | {
        type: "urlNotMatches";
        pattern: string;
    } | {
        type: "gatedContent";
        hard?: boolean | undefined;
        loginPathPattern?: string | undefined;
    } | {
        type: "selectorNotVisible";
        selector: string;
    } | {
        type: "selectorVisible";
        selector: string;
    } | {
        type: "loginFormVisible";
    })[];
    name: string;
    id: string;
    category: "navigation" | "form-validation" | "ui-chaos" | "network-failure" | "authentication" | "code-analysis";
    risk: "high" | "medium" | "low";
    target: string;
    steps: ({
        path: string;
        action: "goto";
    } | {
        action: "click";
        selector: string;
    } | {
        action: "repeatClick";
        selector: string;
        times: number;
        delayMs?: number | undefined;
    } | {
        value: string;
        action: "fill";
        selector: string;
    } | {
        action: "fillAll";
        kind: "valid" | "long" | "special" | "unicode" | "xss-marker" | "invalid-email" | "invalid-number" | "empty";
        scope?: string | undefined;
    } | {
        action: "submit";
        selector: string;
    } | {
        action: "press";
        key: "Enter" | "Escape" | "Tab" | "ArrowDown" | "ArrowUp";
    } | {
        action: "reload";
    } | {
        action: "goBack";
    } | {
        action: "goForward";
    } | {
        action: "setViewport";
        width: number;
        height: number;
    } | {
        mode: "timeout" | "offline" | "http500" | "http429" | "slow";
        action: "setNetwork";
        delayMs?: number | undefined;
    } | {
        action: "clearNetwork";
    } | {
        action: "wait";
        ms: number;
    } | {
        action: "login";
    } | {
        action: "logout";
    } | {
        action: "expireSession";
    } | {
        action: "loginWithBadPassword";
    })[];
    requiresApproval?: boolean | undefined;
    sensitivity?: "deletion" | "purchase" | "account-creation" | "messaging" | "upload" | "irreversible" | undefined;
    description?: string | undefined;
    component?: string | undefined;
    origin?: "heuristic" | "agent" | undefined;
}>;
export type Scenario = z.infer<typeof scenarioSchema>;
export declare const scenarioFileSchema: z.ZodObject<{
    scenarios: z.ZodArray<z.ZodUnknown, "many">;
}, "strip", z.ZodTypeAny, {
    scenarios: unknown[];
}, {
    scenarios: unknown[];
}>;
