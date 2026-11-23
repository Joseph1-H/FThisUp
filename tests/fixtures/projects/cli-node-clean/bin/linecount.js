#!/usr/bin/env node
// A correct CLI. FThisUp must not report confirmed findings here.
const fs = require('node:fs');
const args = process.argv.slice(2);
const die = (msg, code = 2) => { process.stderr.write(`linecount: ${msg}\n`); process.exit(code); };
process.on('SIGINT', () => process.exit(130));

if (args[0] === '--help' || args[0] === '-h') { console.log('usage: linecount [FILE]\n  --help   show help'); process.exit(0); }
const unknown = args.find((a) => a.startsWith('-') && a !== '-');
if (unknown) die(`unknown option: ${unknown.slice(0, 40)}`);

if (args[0] && args[0] !== '-') {
  let text;
  try { text = fs.readFileSync(args[0], 'utf8'); } catch (e) { die(`cannot read ${args[0].slice(0, 80)}: ${e.code || 'error'}`, 1); }
  console.log(text.split('\n').length);
} else {
  const chunks = [];
  process.stdin.on('data', (d) => chunks.push(d));
  process.stdin.on('end', () => {
    const text = Buffer.concat(chunks).toString('utf8');
    if (text.trim() === '') { console.log(0); return; }
    try { const arr = JSON.parse(text); console.log(Array.isArray(arr) ? arr.length : 1); }
    catch { console.log(text.split('\n').length); }
  });
}
