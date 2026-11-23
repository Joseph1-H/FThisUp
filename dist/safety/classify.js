const RULES = [
    ['deletion', /\b(delete|remove|destroy|erase|wipe|drop|deactivate|close account|cancel (my )?(account|subscription|order))\b/i],
    ['purchase', /\b(buy|purchase|pay|payment|checkout|check out|order now|place order|subscribe|donate|billing|credit card|add to cart)\b/i],
    ['account-creation', /\b(sign ?up|register|create (an )?account|join now|new account)\b/i],
    ['messaging', /\b(send|message|e-?mail us|contact us|invite|newsletter|notify|broadcast|reply|tweet|share)\b/i],
    ['upload', /\b(upload|attach|import file)\b/i],
    ['irreversible', /\b(transfer|publish|reset|revoke|terminate|submit order|confirm)\b/i],
];
/** Keyword classification of what a form/button would do. Conservative: when matched, the scenario needs approval. */
export function classifySensitivity(...texts) {
    const joined = texts.filter(Boolean).join(' ');
    for (const [kind, re] of RULES)
        if (re.test(joined))
            return kind;
    return undefined;
}
