export interface RuntimeInfo {
    flutter: boolean;
    devices: Array<{
        id: string;
        name: string;
        platform: string;
        emulator: boolean;
    }>;
    mobile: boolean;
    note: string;
}
/** Which devices could run integration tests? Only LISTS what already exists: never starts an emulator or changes device config. */
export declare function detectFlutterRuntime(compDir: string, root: string): Promise<RuntimeInfo>;
