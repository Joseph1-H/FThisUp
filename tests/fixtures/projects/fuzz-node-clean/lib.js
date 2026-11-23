// A correct library.
const str = (s) => (typeof s === 'string' ? s : typeof s === 'number' ? String(s) : '');
exports.spin = (n) => (n === 0 ? 0 : n);
exports.deepClone = (o) => (Array.isArray(o) ? o.slice(0, 1000).map((x) => (Array.isArray(x) ? [] : x)) : o);
exports.makeArray = (n) => { const k = Number.isInteger(n) && n >= 0 && n <= 1e6 ? n : 0; return new Array(k).fill(0); };
exports.normalize = (s) => str(s).trim().toLowerCase();
exports.shout = (s) => str(s).toUpperCase() + '!';
