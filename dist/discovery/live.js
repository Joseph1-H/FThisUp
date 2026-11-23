import { resolveSameOrigin } from '../safety/policy.js';
import { createSession, settle } from '../engines/playwright/session.js';
const SENSITIVE_ROUTE = /\/(log-?out|sign-?out|delete|remove|destroy|unsubscribe|deactivate|checkout\/confirm|purchase)(\/|$|\?)/i;
export function globToRegExp(glob) {
    const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
    return new RegExp(`^${esc}$`);
}
export function isExcluded(p, patterns) {
    return patterns.some((g) => globToRegExp(g).test(p));
}
/** Runs in the browser. Plain function (no closures) so it can be serialised. */
function extractPage() {
    const txt = (e) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const visible = (e) => {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const links = Array.from(document.querySelectorAll('a[href]')).map((a) => ({ href: a.href }));
    const formEls = Array.from(document.querySelectorAll('form'));
    const SUBMIT = 'button:not([type=button]):not([type=reset]), input[type=submit], input[type=image]';
    const forms = formEls.map((f, fi) => {
        const controls = Array.from(f.querySelectorAll('input,textarea,select'));
        const fields = controls.map((c, index) => {
            const el = c;
            const id = el.id;
            const label = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) || el.closest('label');
            return {
                index,
                tag: el.tagName.toLowerCase(),
                type: (el.getAttribute('type') || (el.tagName === 'TEXTAREA' ? 'textarea' : el.tagName === 'SELECT' ? 'select' : 'text')).toLowerCase(),
                name: el.name || '',
                id,
                required: el.required,
                pattern: el.getAttribute('pattern') || undefined,
                min: el.getAttribute('min') || undefined,
                max: el.getAttribute('max') || undefined,
                maxLength: el.maxLength > 0 ? el.maxLength : undefined,
                label: txt(label) || el.getAttribute('aria-label') || el.placeholder || undefined,
            };
        });
        const submits = Array.from(f.querySelectorAll(SUBMIT));
        const first = submits[0];
        const t = (e) => e.value || txt(e);
        const constraints = fields.some((x) => x.required || x.pattern || x.min || x.max || x.maxLength || ['email', 'number', 'url', 'tel', 'date'].includes(x.type));
        return {
            selector: `form >> nth=${fi}`,
            action: f.getAttribute('action') || '',
            method: (f.getAttribute('method') || 'get').toLowerCase(),
            noValidate: f.noValidate,
            fields,
            submit: first && visible(first) ? { selector: `form >> nth=${fi} >> :is(${SUBMIT}) >> nth=0`, text: t(first) } : undefined,
            text: txt(f).slice(0, 200) + ' ' + (f.querySelector('legend,h1,h2,h3')?.textContent ?? ''),
            hasConstraints: constraints,
            hasPassword: fields.some((x) => x.type === 'password'),
            hasFile: fields.some((x) => x.type === 'file'),
        };
    });
    const allButtons = Array.from(document.querySelectorAll('button,[role=button]'));
    const buttons = allButtons
        .map((b, i) => ({ b, i }))
        .filter(({ b }) => !b.closest('form') && visible(b) && !b.disabled)
        .map(({ b, i }) => ({ selector: `:is(button,[role=button]) >> nth=${i}`, text: txt(b) || b.getAttribute('aria-label') || '' }));
    return { title: document.title, links, forms, buttons };
}
export async function discoverLive(browser, guard, opts) {
    const origin = guard.origin;
    const session = await createSession(browser, guard);
    const { page, recorder } = session;
    page.setDefaultTimeout(Math.min(opts.timeout, 10000));
    const pages = [];
    const skippedRoutes = [];
    const queue = [{ path: '/' }, ...(opts.seeds ?? []).map((p) => ({ path: p, from: undefined }))];
    const seen = new Set();
    let truncated = false;
    try {
        while (queue.length) {
            const next = queue.shift();
            const abs = resolveSameOrigin(origin, next.path);
            if (!abs)
                continue;
            const u = new URL(abs);
            const key = u.pathname + u.search;
            if (seen.has(key))
                continue;
            seen.add(key);
            if (isExcluded(u.pathname, opts.excludeRoutes)) {
                skippedRoutes.push({ path: key, reason: 'excluded by configuration' });
                continue;
            }
            if (SENSITIVE_ROUTE.test(key)) {
                skippedRoutes.push({ path: key, reason: 'sensitive route (logout/delete/etc.) not visited' });
                continue;
            }
            if (pages.length >= opts.maxPages) {
                truncated = true;
                break;
            }
            recorder.pageErrors.length = 0;
            recorder.apiCalls.length = 0;
            let status = null;
            const info = { path: key, status: null, title: '', linkedFrom: next.from, forms: [], buttons: [], links: [], apiCalls: [], loadErrors: [] };
            try {
                const resp = await page.goto(abs, { waitUntil: 'load', timeout: opts.timeout });
                status = resp?.status() ?? null;
                await settle(page);
                const here = new URL(page.url());
                if (here.origin !== origin) {
                    skippedRoutes.push({ path: key, reason: `redirected off-origin to ${here.origin}` });
                    continue;
                }
                info.finalPath = here.pathname + here.search;
                info.status = status;
                if (status !== null && status < 400) {
                    const data = await page.evaluate(extractPage);
                    info.title = data.title;
                    info.forms = data.forms.map((f, i) => ({ ...f, id: `f${i}` }));
                    info.buttons = data.buttons.slice(0, 12);
                    const hrefs = new Set();
                    for (const l of data.links) {
                        let lu;
                        try {
                            lu = new URL(l.href);
                        }
                        catch {
                            continue;
                        }
                        if (lu.origin !== origin || !/^https?:$/.test(lu.protocol))
                            continue;
                        const k = lu.pathname + lu.search;
                        hrefs.add(k);
                        if (!seen.has(k))
                            queue.push({ path: k, from: key });
                    }
                    info.links = [...hrefs];
                }
            }
            catch (e) {
                info.loadErrors.push(e.message.split('\n')[0] ?? 'navigation failed');
            }
            info.loadErrors.push(...recorder.pageErrors.slice());
            info.apiCalls = recorder.apiCalls.map((c) => ({ method: c.method, path: new URL(c.url).pathname }));
            pages.push(info);
        }
    }
    finally {
        await session.close();
    }
    return { origin, pages, skippedRoutes, truncated };
}
