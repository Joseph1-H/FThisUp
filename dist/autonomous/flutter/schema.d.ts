import { z } from 'zod';
export declare const isFrameworkWidget: (n: string) => boolean;
export declare const finderSchema: z.ZodObject<{
    by: z.ZodEnum<["key", "text", "textContaining", "type", "tooltip", "label"]>;
    value: z.ZodString;
    /** which match to use when several widgets match (default: the first) */
    index: z.ZodOptional<z.ZodNumber>;
}, "strict", z.ZodTypeAny, {
    value: string;
    by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
    index?: number | undefined;
}, {
    value: string;
    by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
    index?: number | undefined;
}>;
export type Finder = z.infer<typeof finderSchema>;
export declare const TEXT_PRESETS: readonly ["empty", "whitespace", "long", "long-words", "unicode", "emoji", "rtl", "negative", "zero", "huge-number", "decimal", "markup", "quote", "newline"];
export declare const textSchema: z.ZodUnion<[z.ZodString, z.ZodObject<{
    preset: z.ZodEnum<["empty", "whitespace", "long", "long-words", "unicode", "emoji", "rtl", "negative", "zero", "huge-number", "decimal", "markup", "quote", "newline"]>;
}, "strict", z.ZodTypeAny, {
    preset: "quote" | "long" | "unicode" | "empty" | "whitespace" | "long-words" | "emoji" | "rtl" | "negative" | "zero" | "huge-number" | "decimal" | "markup" | "newline";
}, {
    preset: "quote" | "long" | "unicode" | "empty" | "whitespace" | "long-words" | "emoji" | "rtl" | "negative" | "zero" | "huge-number" | "decimal" | "markup" | "newline";
}>, z.ZodObject<{
    repeat: z.ZodObject<{
        unit: z.ZodString;
        times: z.ZodNumber;
    }, "strict", z.ZodTypeAny, {
        times: number;
        unit: string;
    }, {
        times: number;
        unit: string;
    }>;
}, "strict", z.ZodTypeAny, {
    repeat: {
        times: number;
        unit: string;
    };
}, {
    repeat: {
        times: number;
        unit: string;
    };
}>]>;
export type TextValue = z.infer<typeof textSchema>;
export declare const assertionSchema: z.ZodUnion<[z.ZodObject<{
    target: z.ZodObject<{
        by: z.ZodEnum<["key", "text", "textContaining", "type", "tooltip", "label"]>;
        value: z.ZodString;
        /** which match to use when several widgets match (default: the first) */
        index: z.ZodOptional<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    }, {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    }>;
    kind: z.ZodLiteral<"visible">;
}, "strict", z.ZodTypeAny, {
    kind: "visible";
    target: {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    };
}, {
    kind: "visible";
    target: {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    };
}>, z.ZodObject<{
    target: z.ZodObject<{
        by: z.ZodEnum<["key", "text", "textContaining", "type", "tooltip", "label"]>;
        value: z.ZodString;
        /** which match to use when several widgets match (default: the first) */
        index: z.ZodOptional<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    }, {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    }>;
    kind: z.ZodLiteral<"absent">;
}, "strict", z.ZodTypeAny, {
    kind: "absent";
    target: {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    };
}, {
    kind: "absent";
    target: {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    };
}>, z.ZodEffects<z.ZodObject<{
    equals: z.ZodOptional<z.ZodNumber>;
    atLeast: z.ZodOptional<z.ZodNumber>;
    atMost: z.ZodOptional<z.ZodNumber>;
    target: z.ZodObject<{
        by: z.ZodEnum<["key", "text", "textContaining", "type", "tooltip", "label"]>;
        value: z.ZodString;
        /** which match to use when several widgets match (default: the first) */
        index: z.ZodOptional<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    }, {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    }>;
    kind: z.ZodLiteral<"count">;
}, "strict", z.ZodTypeAny, {
    kind: "count";
    target: {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    };
    equals?: number | undefined;
    atLeast?: number | undefined;
    atMost?: number | undefined;
}, {
    kind: "count";
    target: {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    };
    equals?: number | undefined;
    atLeast?: number | undefined;
    atMost?: number | undefined;
}>, {
    kind: "count";
    target: {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    };
    equals?: number | undefined;
    atLeast?: number | undefined;
    atMost?: number | undefined;
}, {
    kind: "count";
    target: {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    };
    equals?: number | undefined;
    atLeast?: number | undefined;
    atMost?: number | undefined;
}>, z.ZodObject<{
    enabled: z.ZodBoolean;
    target: z.ZodObject<{
        by: z.ZodEnum<["key", "text", "textContaining", "type", "tooltip", "label"]>;
        value: z.ZodString;
        /** which match to use when several widgets match (default: the first) */
        index: z.ZodOptional<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    }, {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    }>;
    kind: z.ZodLiteral<"buttonEnabled">;
}, "strict", z.ZodTypeAny, {
    enabled: boolean;
    kind: "buttonEnabled";
    target: {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    };
}, {
    enabled: boolean;
    kind: "buttonEnabled";
    target: {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    };
}>]>;
export type Assertion = z.infer<typeof assertionSchema>;
declare const leaf: readonly [z.ZodObject<{
    do: z.ZodLiteral<"enterText">;
    target: z.ZodObject<{
        by: z.ZodEnum<["key", "text", "textContaining", "type", "tooltip", "label"]>;
        value: z.ZodString;
        /** which match to use when several widgets match (default: the first) */
        index: z.ZodOptional<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    }, {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    }>;
    text: z.ZodUnion<[z.ZodString, z.ZodObject<{
        preset: z.ZodEnum<["empty", "whitespace", "long", "long-words", "unicode", "emoji", "rtl", "negative", "zero", "huge-number", "decimal", "markup", "quote", "newline"]>;
    }, "strict", z.ZodTypeAny, {
        preset: "quote" | "long" | "unicode" | "empty" | "whitespace" | "long-words" | "emoji" | "rtl" | "negative" | "zero" | "huge-number" | "decimal" | "markup" | "newline";
    }, {
        preset: "quote" | "long" | "unicode" | "empty" | "whitespace" | "long-words" | "emoji" | "rtl" | "negative" | "zero" | "huge-number" | "decimal" | "markup" | "newline";
    }>, z.ZodObject<{
        repeat: z.ZodObject<{
            unit: z.ZodString;
            times: z.ZodNumber;
        }, "strict", z.ZodTypeAny, {
            times: number;
            unit: string;
        }, {
            times: number;
            unit: string;
        }>;
    }, "strict", z.ZodTypeAny, {
        repeat: {
            times: number;
            unit: string;
        };
    }, {
        repeat: {
            times: number;
            unit: string;
        };
    }>]>;
}, "strict", z.ZodTypeAny, {
    target: {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    };
    text: string | {
        preset: "quote" | "long" | "unicode" | "empty" | "whitespace" | "long-words" | "emoji" | "rtl" | "negative" | "zero" | "huge-number" | "decimal" | "markup" | "newline";
    } | {
        repeat: {
            times: number;
            unit: string;
        };
    };
    do: "enterText";
}, {
    target: {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    };
    text: string | {
        preset: "quote" | "long" | "unicode" | "empty" | "whitespace" | "long-words" | "emoji" | "rtl" | "negative" | "zero" | "huge-number" | "decimal" | "markup" | "newline";
    } | {
        repeat: {
            times: number;
            unit: string;
        };
    };
    do: "enterText";
}>, z.ZodObject<{
    do: z.ZodLiteral<"tap">;
    target: z.ZodObject<{
        by: z.ZodEnum<["key", "text", "textContaining", "type", "tooltip", "label"]>;
        value: z.ZodString;
        /** which match to use when several widgets match (default: the first) */
        index: z.ZodOptional<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    }, {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    }>;
}, "strict", z.ZodTypeAny, {
    target: {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    };
    do: "tap";
}, {
    target: {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    };
    do: "tap";
}>, z.ZodObject<{
    do: z.ZodLiteral<"doubleTap">;
    target: z.ZodObject<{
        by: z.ZodEnum<["key", "text", "textContaining", "type", "tooltip", "label"]>;
        value: z.ZodString;
        /** which match to use when several widgets match (default: the first) */
        index: z.ZodOptional<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    }, {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    }>;
}, "strict", z.ZodTypeAny, {
    target: {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    };
    do: "doubleTap";
}, {
    target: {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    };
    do: "doubleTap";
}>, z.ZodObject<{
    do: z.ZodLiteral<"longPress">;
    target: z.ZodObject<{
        by: z.ZodEnum<["key", "text", "textContaining", "type", "tooltip", "label"]>;
        value: z.ZodString;
        /** which match to use when several widgets match (default: the first) */
        index: z.ZodOptional<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    }, {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    }>;
}, "strict", z.ZodTypeAny, {
    target: {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    };
    do: "longPress";
}, {
    target: {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    };
    do: "longPress";
}>, z.ZodObject<{
    do: z.ZodLiteral<"rapidTap">;
    target: z.ZodObject<{
        by: z.ZodEnum<["key", "text", "textContaining", "type", "tooltip", "label"]>;
        value: z.ZodString;
        /** which match to use when several widgets match (default: the first) */
        index: z.ZodOptional<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    }, {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    }>;
    times: z.ZodNumber;
    gapMs: z.ZodDefault<z.ZodNumber>;
}, "strict", z.ZodTypeAny, {
    times: number;
    target: {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    };
    do: "rapidTap";
    gapMs: number;
}, {
    times: number;
    target: {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    };
    do: "rapidTap";
    gapMs?: number | undefined;
}>, z.ZodObject<{
    do: z.ZodLiteral<"drag">;
    target: z.ZodObject<{
        by: z.ZodEnum<["key", "text", "textContaining", "type", "tooltip", "label"]>;
        value: z.ZodString;
        /** which match to use when several widgets match (default: the first) */
        index: z.ZodOptional<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    }, {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    }>;
    dx: z.ZodNumber;
    dy: z.ZodNumber;
}, "strict", z.ZodTypeAny, {
    target: {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    };
    do: "drag";
    dx: number;
    dy: number;
}, {
    target: {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    };
    do: "drag";
    dx: number;
    dy: number;
}>, z.ZodObject<{
    do: z.ZodLiteral<"fling">;
    target: z.ZodObject<{
        by: z.ZodEnum<["key", "text", "textContaining", "type", "tooltip", "label"]>;
        value: z.ZodString;
        /** which match to use when several widgets match (default: the first) */
        index: z.ZodOptional<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    }, {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    }>;
    dx: z.ZodNumber;
    dy: z.ZodNumber;
}, "strict", z.ZodTypeAny, {
    target: {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    };
    do: "fling";
    dx: number;
    dy: number;
}, {
    target: {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    };
    do: "fling";
    dx: number;
    dy: number;
}>, z.ZodObject<{
    do: z.ZodLiteral<"scrollIntoView">;
    target: z.ZodObject<{
        by: z.ZodEnum<["key", "text", "textContaining", "type", "tooltip", "label"]>;
        value: z.ZodString;
        /** which match to use when several widgets match (default: the first) */
        index: z.ZodOptional<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    }, {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    }>;
}, "strict", z.ZodTypeAny, {
    target: {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    };
    do: "scrollIntoView";
}, {
    target: {
        value: string;
        by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
        index?: number | undefined;
    };
    do: "scrollIntoView";
}>, z.ZodObject<{
    do: z.ZodLiteral<"pump">;
    ms: z.ZodNumber;
}, "strict", z.ZodTypeAny, {
    ms: number;
    do: "pump";
}, {
    ms: number;
    do: "pump";
}>, z.ZodObject<{
    do: z.ZodLiteral<"settle">;
}, "strict", z.ZodTypeAny, {
    do: "settle";
}, {
    do: "settle";
}>, z.ZodObject<{
    do: z.ZodLiteral<"back">;
}, "strict", z.ZodTypeAny, {
    do: "back";
}, {
    do: "back";
}>, z.ZodObject<{
    do: z.ZodLiteral<"dispose">;
    ms: z.ZodDefault<z.ZodNumber>;
}, "strict", z.ZodTypeAny, {
    ms: number;
    do: "dispose";
}, {
    do: "dispose";
    ms?: number | undefined;
}>, z.ZodObject<{
    do: z.ZodLiteral<"expect">;
    assert: z.ZodUnion<[z.ZodObject<{
        target: z.ZodObject<{
            by: z.ZodEnum<["key", "text", "textContaining", "type", "tooltip", "label"]>;
            value: z.ZodString;
            /** which match to use when several widgets match (default: the first) */
            index: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        }, {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        }>;
        kind: z.ZodLiteral<"visible">;
    }, "strict", z.ZodTypeAny, {
        kind: "visible";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
    }, {
        kind: "visible";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
    }>, z.ZodObject<{
        target: z.ZodObject<{
            by: z.ZodEnum<["key", "text", "textContaining", "type", "tooltip", "label"]>;
            value: z.ZodString;
            /** which match to use when several widgets match (default: the first) */
            index: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        }, {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        }>;
        kind: z.ZodLiteral<"absent">;
    }, "strict", z.ZodTypeAny, {
        kind: "absent";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
    }, {
        kind: "absent";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
    }>, z.ZodEffects<z.ZodObject<{
        equals: z.ZodOptional<z.ZodNumber>;
        atLeast: z.ZodOptional<z.ZodNumber>;
        atMost: z.ZodOptional<z.ZodNumber>;
        target: z.ZodObject<{
            by: z.ZodEnum<["key", "text", "textContaining", "type", "tooltip", "label"]>;
            value: z.ZodString;
            /** which match to use when several widgets match (default: the first) */
            index: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        }, {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        }>;
        kind: z.ZodLiteral<"count">;
    }, "strict", z.ZodTypeAny, {
        kind: "count";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
        equals?: number | undefined;
        atLeast?: number | undefined;
        atMost?: number | undefined;
    }, {
        kind: "count";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
        equals?: number | undefined;
        atLeast?: number | undefined;
        atMost?: number | undefined;
    }>, {
        kind: "count";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
        equals?: number | undefined;
        atLeast?: number | undefined;
        atMost?: number | undefined;
    }, {
        kind: "count";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
        equals?: number | undefined;
        atLeast?: number | undefined;
        atMost?: number | undefined;
    }>, z.ZodObject<{
        enabled: z.ZodBoolean;
        target: z.ZodObject<{
            by: z.ZodEnum<["key", "text", "textContaining", "type", "tooltip", "label"]>;
            value: z.ZodString;
            /** which match to use when several widgets match (default: the first) */
            index: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        }, {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        }>;
        kind: z.ZodLiteral<"buttonEnabled">;
    }, "strict", z.ZodTypeAny, {
        enabled: boolean;
        kind: "buttonEnabled";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
    }, {
        enabled: boolean;
        kind: "buttonEnabled";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
    }>]>;
}, "strict", z.ZodTypeAny, {
    assert: {
        kind: "visible";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
    } | {
        kind: "absent";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
    } | {
        kind: "count";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
        equals?: number | undefined;
        atLeast?: number | undefined;
        atMost?: number | undefined;
    } | {
        enabled: boolean;
        kind: "buttonEnabled";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
    };
    do: "expect";
}, {
    assert: {
        kind: "visible";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
    } | {
        kind: "absent";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
    } | {
        kind: "count";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
        equals?: number | undefined;
        atLeast?: number | undefined;
        atMost?: number | undefined;
    } | {
        enabled: boolean;
        kind: "buttonEnabled";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
    };
    do: "expect";
}>];
export type Step = z.infer<(typeof leaf)[number]> | {
    do: 'repeat';
    times: number;
    steps: Step[];
};
export declare const stepSchema: z.ZodType<Step>;
export declare const flutterScenarioSchema: z.ZodObject<{
    method: z.ZodOptional<z.ZodEnum<["agent", "engine-heuristic"]>>;
    screen: z.ZodObject<{
        /** class name of the widget to pump (must exist in the app map) */
        widget: z.ZodString;
        /** named constructor arguments, literal values only */
        args: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>>;
        wrap: z.ZodDefault<z.ZodEnum<["materialApp", "materialApp+scaffold"]>>;
        viewport: z.ZodDefault<z.ZodObject<{
            width: z.ZodNumber;
            height: z.ZodNumber;
        }, "strict", z.ZodTypeAny, {
            width: number;
            height: number;
        }, {
            width: number;
            height: number;
        }>>;
    }, "strict", z.ZodTypeAny, {
        args: Record<string, string | number | boolean | null>;
        widget: string;
        wrap: "materialApp" | "materialApp+scaffold";
        viewport: {
            width: number;
            height: number;
        };
    }, {
        widget: string;
        args?: Record<string, string | number | boolean | null> | undefined;
        wrap?: "materialApp" | "materialApp+scaffold" | undefined;
        viewport?: {
            width: number;
            height: number;
        } | undefined;
    }>;
    steps: z.ZodArray<z.ZodType<Step, z.ZodTypeDef, Step>, "many">;
    /** evaluated after all steps */
    assertions: z.ZodDefault<z.ZodArray<z.ZodUnion<[z.ZodObject<{
        target: z.ZodObject<{
            by: z.ZodEnum<["key", "text", "textContaining", "type", "tooltip", "label"]>;
            value: z.ZodString;
            /** which match to use when several widgets match (default: the first) */
            index: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        }, {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        }>;
        kind: z.ZodLiteral<"visible">;
    }, "strict", z.ZodTypeAny, {
        kind: "visible";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
    }, {
        kind: "visible";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
    }>, z.ZodObject<{
        target: z.ZodObject<{
            by: z.ZodEnum<["key", "text", "textContaining", "type", "tooltip", "label"]>;
            value: z.ZodString;
            /** which match to use when several widgets match (default: the first) */
            index: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        }, {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        }>;
        kind: z.ZodLiteral<"absent">;
    }, "strict", z.ZodTypeAny, {
        kind: "absent";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
    }, {
        kind: "absent";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
    }>, z.ZodEffects<z.ZodObject<{
        equals: z.ZodOptional<z.ZodNumber>;
        atLeast: z.ZodOptional<z.ZodNumber>;
        atMost: z.ZodOptional<z.ZodNumber>;
        target: z.ZodObject<{
            by: z.ZodEnum<["key", "text", "textContaining", "type", "tooltip", "label"]>;
            value: z.ZodString;
            /** which match to use when several widgets match (default: the first) */
            index: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        }, {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        }>;
        kind: z.ZodLiteral<"count">;
    }, "strict", z.ZodTypeAny, {
        kind: "count";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
        equals?: number | undefined;
        atLeast?: number | undefined;
        atMost?: number | undefined;
    }, {
        kind: "count";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
        equals?: number | undefined;
        atLeast?: number | undefined;
        atMost?: number | undefined;
    }>, {
        kind: "count";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
        equals?: number | undefined;
        atLeast?: number | undefined;
        atMost?: number | undefined;
    }, {
        kind: "count";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
        equals?: number | undefined;
        atLeast?: number | undefined;
        atMost?: number | undefined;
    }>, z.ZodObject<{
        enabled: z.ZodBoolean;
        target: z.ZodObject<{
            by: z.ZodEnum<["key", "text", "textContaining", "type", "tooltip", "label"]>;
            value: z.ZodString;
            /** which match to use when several widgets match (default: the first) */
            index: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        }, {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        }>;
        kind: z.ZodLiteral<"buttonEnabled">;
    }, "strict", z.ZodTypeAny, {
        enabled: boolean;
        kind: "buttonEnabled";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
    }, {
        enabled: boolean;
        kind: "buttonEnabled";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
    }>]>, "many">>;
    id: z.ZodString;
    name: z.ZodString;
    feature: z.ZodString;
    risk: z.ZodString;
    expectation: z.ZodObject<{
        statement: z.ZodString;
        basis: z.ZodEnum<["invariant", "documented", "code", "test", "assumption"]>;
        reference: z.ZodOptional<z.ZodObject<{
            file: z.ZodString;
            line: z.ZodOptional<z.ZodNumber>;
            quote: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            file: string;
            quote: string;
            line?: number | undefined;
        }, {
            file: string;
            quote: string;
            line?: number | undefined;
        }>>;
    }, "strict", z.ZodTypeAny, {
        statement: string;
        basis: "code" | "invariant" | "documented" | "test" | "assumption";
        reference?: {
            file: string;
            quote: string;
            line?: number | undefined;
        } | undefined;
    }, {
        statement: string;
        basis: "code" | "invariant" | "documented" | "test" | "assumption";
        reference?: {
            file: string;
            quote: string;
            line?: number | undefined;
        } | undefined;
    }>;
    hypothesis: z.ZodOptional<z.ZodString>;
    priority: z.ZodDefault<z.ZodEnum<["high", "medium", "low"]>>;
}, "strict", z.ZodTypeAny, {
    name: string;
    id: string;
    risk: string;
    steps: Step[];
    priority: "high" | "medium" | "low";
    screen: {
        args: Record<string, string | number | boolean | null>;
        widget: string;
        wrap: "materialApp" | "materialApp+scaffold";
        viewport: {
            width: number;
            height: number;
        };
    };
    assertions: ({
        kind: "visible";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
    } | {
        kind: "absent";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
    } | {
        kind: "count";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
        equals?: number | undefined;
        atLeast?: number | undefined;
        atMost?: number | undefined;
    } | {
        enabled: boolean;
        kind: "buttonEnabled";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
    })[];
    feature: string;
    expectation: {
        statement: string;
        basis: "code" | "invariant" | "documented" | "test" | "assumption";
        reference?: {
            file: string;
            quote: string;
            line?: number | undefined;
        } | undefined;
    };
    method?: "agent" | "engine-heuristic" | undefined;
    hypothesis?: string | undefined;
}, {
    name: string;
    id: string;
    risk: string;
    steps: Step[];
    screen: {
        widget: string;
        args?: Record<string, string | number | boolean | null> | undefined;
        wrap?: "materialApp" | "materialApp+scaffold" | undefined;
        viewport?: {
            width: number;
            height: number;
        } | undefined;
    };
    feature: string;
    expectation: {
        statement: string;
        basis: "code" | "invariant" | "documented" | "test" | "assumption";
        reference?: {
            file: string;
            quote: string;
            line?: number | undefined;
        } | undefined;
    };
    method?: "agent" | "engine-heuristic" | undefined;
    hypothesis?: string | undefined;
    priority?: "high" | "medium" | "low" | undefined;
    assertions?: ({
        kind: "visible";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
    } | {
        kind: "absent";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
    } | {
        kind: "count";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
        equals?: number | undefined;
        atLeast?: number | undefined;
        atMost?: number | undefined;
    } | {
        enabled: boolean;
        kind: "buttonEnabled";
        target: {
            value: string;
            by: "type" | "key" | "label" | "text" | "textContaining" | "tooltip";
            index?: number | undefined;
        };
    })[] | undefined;
}>;
export type FlutterScenario = z.infer<typeof flutterScenarioSchema>;
export declare const flutterScenarioFileSchema: z.ZodObject<{
    version: z.ZodDefault<z.ZodLiteral<1>>;
    adapter: z.ZodLiteral<"flutter">;
    /** optional: which component (pubspec folder, relative path) these scenarios target; default = the only Flutter component */
    component: z.ZodOptional<z.ZodString>;
    scenarios: z.ZodArray<z.ZodUnknown, "many">;
}, "strict", z.ZodTypeAny, {
    scenarios: unknown[];
    version: 1;
    adapter: "flutter";
    component?: string | undefined;
}, {
    scenarios: unknown[];
    adapter: "flutter";
    component?: string | undefined;
    version?: 1 | undefined;
}>;
export {};
