import { z } from 'zod';
export declare const apiExpectationSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"no5xx">;
}, "strict", z.ZodTypeAny, {
    type: "no5xx";
}, {
    type: "no5xx";
}>, z.ZodObject<{
    type: z.ZodLiteral<"statusIn">;
    codes: z.ZodArray<z.ZodNumber, "many">;
}, "strict", z.ZodTypeAny, {
    type: "statusIn";
    codes: number[];
}, {
    type: "statusIn";
    codes: number[];
}>, z.ZodObject<{
    type: z.ZodLiteral<"rejects">;
}, "strict", z.ZodTypeAny, {
    type: "rejects";
}, {
    type: "rejects";
}>, z.ZodObject<{
    type: z.ZodLiteral<"respondsWithinMs">;
    ms: z.ZodNumber;
}, "strict", z.ZodTypeAny, {
    type: "respondsWithinMs";
    ms: number;
}, {
    type: "respondsWithinMs";
    ms: number;
}>, z.ZodObject<{
    type: z.ZodLiteral<"jsonBody">;
}, "strict", z.ZodTypeAny, {
    type: "jsonBody";
}, {
    type: "jsonBody";
}>, z.ZodObject<{
    type: z.ZodLiteral<"bodyContains">;
    text: z.ZodString;
}, "strict", z.ZodTypeAny, {
    type: "bodyContains";
    text: string;
}, {
    type: "bodyContains";
    text: string;
}>]>;
export type ApiExpectation = z.infer<typeof apiExpectationSchema>;
export declare const apiScenarioSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    method: z.ZodEnum<["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]>;
    path: z.ZodEffects<z.ZodString, string, string>;
    query: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    /** JSON value, or raw string to send as-is (use rawBody to send deliberately malformed JSON) */
    json: z.ZodOptional<z.ZodUnknown>;
    rawBody: z.ZodOptional<z.ZodString>;
    contentType: z.ZodOptional<z.ZodString>;
    expect: z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"no5xx">;
    }, "strict", z.ZodTypeAny, {
        type: "no5xx";
    }, {
        type: "no5xx";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"statusIn">;
        codes: z.ZodArray<z.ZodNumber, "many">;
    }, "strict", z.ZodTypeAny, {
        type: "statusIn";
        codes: number[];
    }, {
        type: "statusIn";
        codes: number[];
    }>, z.ZodObject<{
        type: z.ZodLiteral<"rejects">;
    }, "strict", z.ZodTypeAny, {
        type: "rejects";
    }, {
        type: "rejects";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"respondsWithinMs">;
        ms: z.ZodNumber;
    }, "strict", z.ZodTypeAny, {
        type: "respondsWithinMs";
        ms: number;
    }, {
        type: "respondsWithinMs";
        ms: number;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"jsonBody">;
    }, "strict", z.ZodTypeAny, {
        type: "jsonBody";
    }, {
        type: "jsonBody";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"bodyContains">;
        text: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        type: "bodyContains";
        text: string;
    }, {
        type: "bodyContains";
        text: string;
    }>]>, "many">;
    risk: z.ZodDefault<z.ZodEnum<["low", "medium", "high"]>>;
    requiresApproval: z.ZodDefault<z.ZodBoolean>;
    sensitivity: z.ZodOptional<z.ZodEnum<["deletion", "purchase", "account-creation", "messaging", "upload", "irreversible"]>>;
}, "strict", z.ZodTypeAny, {
    path: string;
    name: string;
    id: string;
    risk: "high" | "medium" | "low";
    requiresApproval: boolean;
    method: "POST" | "PUT" | "PATCH" | "DELETE" | "GET" | "HEAD" | "OPTIONS";
    expect: ({
        type: "no5xx";
    } | {
        type: "statusIn";
        codes: number[];
    } | {
        type: "rejects";
    } | {
        type: "respondsWithinMs";
        ms: number;
    } | {
        type: "jsonBody";
    } | {
        type: "bodyContains";
        text: string;
    })[];
    json?: unknown;
    sensitivity?: "deletion" | "purchase" | "account-creation" | "messaging" | "upload" | "irreversible" | undefined;
    contentType?: string | undefined;
    query?: Record<string, string> | undefined;
    headers?: Record<string, string> | undefined;
    rawBody?: string | undefined;
}, {
    path: string;
    name: string;
    id: string;
    method: "POST" | "PUT" | "PATCH" | "DELETE" | "GET" | "HEAD" | "OPTIONS";
    expect: ({
        type: "no5xx";
    } | {
        type: "statusIn";
        codes: number[];
    } | {
        type: "rejects";
    } | {
        type: "respondsWithinMs";
        ms: number;
    } | {
        type: "jsonBody";
    } | {
        type: "bodyContains";
        text: string;
    })[];
    json?: unknown;
    risk?: "high" | "medium" | "low" | undefined;
    requiresApproval?: boolean | undefined;
    sensitivity?: "deletion" | "purchase" | "account-creation" | "messaging" | "upload" | "irreversible" | undefined;
    contentType?: string | undefined;
    query?: Record<string, string> | undefined;
    headers?: Record<string, string> | undefined;
    rawBody?: string | undefined;
}>;
export type ApiScenario = z.infer<typeof apiScenarioSchema>;
export declare function validateApiScenarios(input: unknown): {
    valid: ApiScenario[];
    rejected: Array<{
        id?: string;
        errors: string[];
    }>;
};
