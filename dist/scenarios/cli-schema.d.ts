import { z } from 'zod';
export declare const cliStdinSchema: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
    kind: z.ZodLiteral<"empty">;
}, "strict", z.ZodTypeAny, {
    kind: "empty";
}, {
    kind: "empty";
}>, z.ZodObject<{
    kind: z.ZodLiteral<"text">;
    text: z.ZodString;
}, "strict", z.ZodTypeAny, {
    kind: "text";
    text: string;
}, {
    kind: "text";
    text: string;
}>, z.ZodObject<{
    kind: z.ZodLiteral<"unicode">;
}, "strict", z.ZodTypeAny, {
    kind: "unicode";
}, {
    kind: "unicode";
}>, z.ZodObject<{
    kind: z.ZodLiteral<"binary">;
    bytes: z.ZodNumber;
}, "strict", z.ZodTypeAny, {
    kind: "binary";
    bytes: number;
}, {
    kind: "binary";
    bytes: number;
}>, z.ZodObject<{
    kind: z.ZodLiteral<"long">;
    bytes: z.ZodNumber;
}, "strict", z.ZodTypeAny, {
    kind: "long";
    bytes: number;
}, {
    kind: "long";
    bytes: number;
}>]>;
export declare const cliExpectationSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"noCrash">;
}, "strict", z.ZodTypeAny, {
    type: "noCrash";
}, {
    type: "noCrash";
}>, z.ZodObject<{
    type: z.ZodLiteral<"noStackTrace">;
}, "strict", z.ZodTypeAny, {
    type: "noStackTrace";
}, {
    type: "noStackTrace";
}>, z.ZodObject<{
    type: z.ZodLiteral<"terminates">;
}, "strict", z.ZodTypeAny, {
    type: "terminates";
}, {
    type: "terminates";
}>, z.ZodObject<{
    type: z.ZodLiteral<"exitCode">;
    oneOf: z.ZodArray<z.ZodNumber, "many">;
}, "strict", z.ZodTypeAny, {
    type: "exitCode";
    oneOf: number[];
}, {
    type: "exitCode";
    oneOf: number[];
}>, z.ZodObject<{
    type: z.ZodLiteral<"nonZeroExit">;
}, "strict", z.ZodTypeAny, {
    type: "nonZeroExit";
}, {
    type: "nonZeroExit";
}>, z.ZodObject<{
    type: z.ZodLiteral<"stderrEmpty">;
}, "strict", z.ZodTypeAny, {
    type: "stderrEmpty";
}, {
    type: "stderrEmpty";
}>, z.ZodObject<{
    type: z.ZodLiteral<"stdoutContains">;
    text: z.ZodString;
}, "strict", z.ZodTypeAny, {
    type: "stdoutContains";
    text: string;
}, {
    type: "stdoutContains";
    text: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"stderrContains">;
    text: z.ZodString;
}, "strict", z.ZodTypeAny, {
    type: "stderrContains";
    text: string;
}, {
    type: "stderrContains";
    text: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"exitsWithinMs">;
    ms: z.ZodNumber;
}, "strict", z.ZodTypeAny, {
    type: "exitsWithinMs";
    ms: number;
}, {
    type: "exitsWithinMs";
    ms: number;
}>]>;
export type CliExpectation = z.infer<typeof cliExpectationSchema>;
export declare const cliScenarioSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    /** name of a discovered/configured CLI target */
    target: z.ZodString;
    argv: z.ZodArray<z.ZodString, "many">;
    stdin: z.ZodOptional<z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
        kind: z.ZodLiteral<"empty">;
    }, "strict", z.ZodTypeAny, {
        kind: "empty";
    }, {
        kind: "empty";
    }>, z.ZodObject<{
        kind: z.ZodLiteral<"text">;
        text: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        kind: "text";
        text: string;
    }, {
        kind: "text";
        text: string;
    }>, z.ZodObject<{
        kind: z.ZodLiteral<"unicode">;
    }, "strict", z.ZodTypeAny, {
        kind: "unicode";
    }, {
        kind: "unicode";
    }>, z.ZodObject<{
        kind: z.ZodLiteral<"binary">;
        bytes: z.ZodNumber;
    }, "strict", z.ZodTypeAny, {
        kind: "binary";
        bytes: number;
    }, {
        kind: "binary";
        bytes: number;
    }>, z.ZodObject<{
        kind: z.ZodLiteral<"long">;
        bytes: z.ZodNumber;
    }, "strict", z.ZodTypeAny, {
        kind: "long";
        bytes: number;
    }, {
        kind: "long";
        bytes: number;
    }>]>>;
    signal: z.ZodOptional<z.ZodObject<{
        afterMs: z.ZodNumber;
        name: z.ZodEnum<["SIGINT", "SIGTERM"]>;
    }, "strict", z.ZodTypeAny, {
        name: "SIGINT" | "SIGTERM";
        afterMs: number;
    }, {
        name: "SIGINT" | "SIGTERM";
        afterMs: number;
    }>>;
    timeoutMs: z.ZodOptional<z.ZodNumber>;
    expect: z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"noCrash">;
    }, "strict", z.ZodTypeAny, {
        type: "noCrash";
    }, {
        type: "noCrash";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"noStackTrace">;
    }, "strict", z.ZodTypeAny, {
        type: "noStackTrace";
    }, {
        type: "noStackTrace";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"terminates">;
    }, "strict", z.ZodTypeAny, {
        type: "terminates";
    }, {
        type: "terminates";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"exitCode">;
        oneOf: z.ZodArray<z.ZodNumber, "many">;
    }, "strict", z.ZodTypeAny, {
        type: "exitCode";
        oneOf: number[];
    }, {
        type: "exitCode";
        oneOf: number[];
    }>, z.ZodObject<{
        type: z.ZodLiteral<"nonZeroExit">;
    }, "strict", z.ZodTypeAny, {
        type: "nonZeroExit";
    }, {
        type: "nonZeroExit";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"stderrEmpty">;
    }, "strict", z.ZodTypeAny, {
        type: "stderrEmpty";
    }, {
        type: "stderrEmpty";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"stdoutContains">;
        text: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        type: "stdoutContains";
        text: string;
    }, {
        type: "stdoutContains";
        text: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"stderrContains">;
        text: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        type: "stderrContains";
        text: string;
    }, {
        type: "stderrContains";
        text: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"exitsWithinMs">;
        ms: z.ZodNumber;
    }, "strict", z.ZodTypeAny, {
        type: "exitsWithinMs";
        ms: number;
    }, {
        type: "exitsWithinMs";
        ms: number;
    }>]>, "many">;
    risk: z.ZodDefault<z.ZodEnum<["low", "medium", "high"]>>;
    requiresApproval: z.ZodDefault<z.ZodBoolean>;
    sensitivity: z.ZodOptional<z.ZodEnum<["deletion", "purchase", "account-creation", "messaging", "upload", "irreversible"]>>;
    description: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    name: string;
    id: string;
    risk: "high" | "medium" | "low";
    target: string;
    requiresApproval: boolean;
    expect: ({
        type: "noCrash";
    } | {
        type: "noStackTrace";
    } | {
        type: "terminates";
    } | {
        type: "exitCode";
        oneOf: number[];
    } | {
        type: "nonZeroExit";
    } | {
        type: "stderrEmpty";
    } | {
        type: "stdoutContains";
        text: string;
    } | {
        type: "stderrContains";
        text: string;
    } | {
        type: "exitsWithinMs";
        ms: number;
    })[];
    argv: string[];
    timeoutMs?: number | undefined;
    sensitivity?: "deletion" | "purchase" | "account-creation" | "messaging" | "upload" | "irreversible" | undefined;
    description?: string | undefined;
    signal?: {
        name: "SIGINT" | "SIGTERM";
        afterMs: number;
    } | undefined;
    stdin?: {
        kind: "empty";
    } | {
        kind: "text";
        text: string;
    } | {
        kind: "unicode";
    } | {
        kind: "binary";
        bytes: number;
    } | {
        kind: "long";
        bytes: number;
    } | undefined;
}, {
    name: string;
    id: string;
    target: string;
    expect: ({
        type: "noCrash";
    } | {
        type: "noStackTrace";
    } | {
        type: "terminates";
    } | {
        type: "exitCode";
        oneOf: number[];
    } | {
        type: "nonZeroExit";
    } | {
        type: "stderrEmpty";
    } | {
        type: "stdoutContains";
        text: string;
    } | {
        type: "stderrContains";
        text: string;
    } | {
        type: "exitsWithinMs";
        ms: number;
    })[];
    argv: string[];
    timeoutMs?: number | undefined;
    risk?: "high" | "medium" | "low" | undefined;
    requiresApproval?: boolean | undefined;
    sensitivity?: "deletion" | "purchase" | "account-creation" | "messaging" | "upload" | "irreversible" | undefined;
    description?: string | undefined;
    signal?: {
        name: "SIGINT" | "SIGTERM";
        afterMs: number;
    } | undefined;
    stdin?: {
        kind: "empty";
    } | {
        kind: "text";
        text: string;
    } | {
        kind: "unicode";
    } | {
        kind: "binary";
        bytes: number;
    } | {
        kind: "long";
        bytes: number;
    } | undefined;
}>;
export type CliScenario = z.infer<typeof cliScenarioSchema>;
export declare function validateCliScenarios(input: unknown, targets: string[]): {
    valid: CliScenario[];
    rejected: Array<{
        id?: string;
        errors: string[];
    }>;
};
