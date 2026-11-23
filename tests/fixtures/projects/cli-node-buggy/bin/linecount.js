#!/usr/bin/env node
// INTENTIONALLY BUGGY CLI used to test FThisUp.
// usage: linecount [FILE]   counts lines of FILE (or JSON array on stdin)
const fs = require('node:fs');
const args = process.argv.slice(2);

if (args[0] === '--help') { console.log('usage: linecount [FILE]\n  --help   show help'); process.exit(0); }

const FLAGS = { '--help': true };
for (const a of args) {
  if (a.startsWith('--')) console.log(FLAGS[a].toString());   // BUG: unknown flag -> uncaught TypeError (stack trace)
}
if (args.some((a) => a.length > 20000)) { for (;;) {} }       // BUG: hangs on very long argument
process.on('SIGINT', () => {});                               // BUG: ignores Ctrl-C

if (args[0] && args[0] !== '-') {
  const text = fs.readFileSync(args[0], 'utf8');              // BUG: missing file -> uncaught ENOENT stack trace
  console.log(text.split('\n').length);
} else {
  let data = '';
  process.stdin.on('data', (d) => (data += d));
  process.stdin.on('end', () => {
    const arr = JSON.parse(data);                             // BUG: empty / non-JSON stdin -> uncaught SyntaxError
    console.log(arr.length);
  });
}
