export class TargetBlockedError extends Error {
    decision;
    constructor(decision) {
        super(decision.reason);
        this.decision = decision;
    }
}
export class TargetUnreachableError extends Error {
    url;
    detail;
    constructor(url, detail) {
        super(`Could not reach ${url}: ${detail}`);
        this.url = url;
        this.detail = detail;
    }
}
export class BrowserMissingError extends Error {
}
export class SafetyEnforcementError extends Error {
}
