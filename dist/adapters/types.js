export function componentsOf(ctx, ids) {
    return ids.map((id) => ctx.manifest.components.find((c) => c.id === id)).filter((c) => !!c);
}
export function emptyEvidence() {
    return { consoleErrors: [], pageErrors: [], networkFailures: [], mutatingRequests: [], blockedRequests: [], notes: [], logs: [], commands: [] };
}
