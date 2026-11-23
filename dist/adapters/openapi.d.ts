export interface ApiParam {
    name: string;
    in: 'path' | 'query' | 'header';
    required: boolean;
    schema?: Schema;
}
export type Schema = {
    type?: string | string[];
    format?: string;
    enum?: unknown[];
    properties?: Record<string, Schema>;
    required?: string[];
    items?: Schema;
    nullable?: boolean;
    example?: unknown;
    default?: unknown;
    minimum?: number;
    maximum?: number;
    $ref?: string;
    allOf?: Schema[];
    oneOf?: Schema[];
    anyOf?: Schema[];
    additionalProperties?: boolean | Schema;
};
export interface ApiEndpoint {
    method: string;
    path: string;
    operationId?: string;
    summary?: string;
    params: ApiParam[];
    body?: {
        required: boolean;
        schema?: Schema;
    };
    /** declared status codes -> response schema (JSON) */
    responses: Record<string, Schema | undefined>;
    /** the spec says this operation needs credentials */
    secured: boolean;
    source: string;
    certainty: 'confirmed' | 'inferred';
}
export interface ApiSpec {
    endpoints: ApiEndpoint[];
    basePath: string;
    components: Record<string, Schema>;
    file?: string;
    notes: string[];
}
export declare function resolveRef(doc: any, s: Schema | undefined, depth?: number): Schema | undefined;
export declare function parseOpenApi(doc: any, file: string): ApiSpec;
/** Find an OpenAPI/Swagger file inside the project (never outside). */
export declare function findSpecFile(root: string, explicit?: string): string | null;
export declare function loadSpecFile(file: string): ApiSpec | null;
/** Route definitions found in source (framework conventions). Inferred only: no schemas. */
export declare function discoverRoutesFromSource(root: string): ApiEndpoint[];
export declare function exampleFromSchema(doc: {
    components: Record<string, Schema>;
}, s: Schema | undefined, depth?: number): unknown;
export declare function wrongTypeValue(doc: {
    components: Record<string, Schema>;
}, s: Schema | undefined): unknown;
export declare function validateValue(doc: {
    components: Record<string, Schema>;
}, value: unknown, s: Schema | undefined, at?: string, depth?: number): string[];
