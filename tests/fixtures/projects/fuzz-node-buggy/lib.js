// INTENTIONALLY BUGGY library used to test FThisUp.
exports.spin = (n) => { while (n === 0) {} return n; };                                   // BUG: infinite loop on 0
exports.deepClone = (o) => (Array.isArray(o) ? o.map(exports.deepClone) : o);               // BUG: stack overflow on deep nesting
exports.makeArray = (n) => new Array(n).fill(0);                                           // BUG: RangeError on -1 / huge n
exports.normalize = (s) => { if (s === '') process.abort(); return String(s).trim().toLowerCase(); }; // BUG: native abort on ''
exports.shout = (s) => String(s).toUpperCase() + '!';
