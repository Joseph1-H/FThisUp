const useColor = () => !process.env.NO_COLOR && process.env.FORCE_COLOR !== '0' && (!!process.stdout.isTTY || !!process.env.FORCE_COLOR);
const wrap = (open: number, close: number) => (s: string) => (useColor() ? `\u001b[${open}m${s}\u001b[${close}m` : s);
export const c = {
  red: wrap(31, 39), green: wrap(32, 39), yellow: wrap(33, 39), dim: wrap(2, 22), bold: wrap(1, 22), gray: wrap(90, 39), cyan: wrap(36, 39),
};

export const BANNER = String.raw`
  ______ _____ _   _ ___ ____  _   _ ____
 |  ____|_   _| | | |_ _/ ___|| | | |  _ \
 | |_     | | | |_| || |\___ \| | | | |_) |
 |  _|    | | |  _  || | ___) | |_| |  __/
 |_|      |_| |_| |_|___|____/ \___/|_|
`;

export function printBanner(target?: string) {
  console.log(c.red(BANNER));
  console.log(`   ${c.bold('Your AI built it.')}`);
  console.log(`   ${c.bold('Now let another AI try to destroy it.')}\n`);
  if (target) console.log(`   Target: ${c.cyan(target)}\n`);
}

export const tag = {
  pass: () => c.green('[PASS]'), fail: () => c.red('[FAIL]'), warn: () => c.yellow('[WARN]'), skip: () => c.gray('[SKIP]'), info: () => c.gray('[INFO]'),
};

export const CATEGORY_LABEL: Record<string, string> = {
  navigation: 'Navigation',
  'form-validation': 'Form validation',
  'ui-chaos': 'UI chaos',
  'network-failure': 'Network error handling',
  authentication: 'Authentication',
  'code-analysis': 'Code analysis',
};

export function progressLine(i: number, total: number, name: string, outcome: string) {
  if (!process.stdout.isTTY) return;
  const msg = `   ${c.gray(`[${i}/${total}]`)} ${outcome === 'failed' ? c.red('✖') : outcome === 'passed' ? c.green('✔') : c.yellow('•')} ${name}`;
  process.stdout.write(`\r\u001b[2K${msg.slice(0, Math.max(40, (process.stdout.columns ?? 100) + 20))}`);
}
export function clearProgress() {
  if (process.stdout.isTTY) process.stdout.write('\r\u001b[2K');
}
