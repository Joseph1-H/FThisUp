export interface RunningApp {
    stop: () => void;
}
/** Optional (--start): launches the user's own configured start command and waits for the URL. */
export declare function startApp(command: string, cwd: string, url: string, timeoutMs?: number): Promise<RunningApp>;
