const test = require('node:test');
const assert = require('node:assert');
const { sum, title } = require('../index.js');
test('sum adds', () => assert.strictEqual(sum(2, 3), 5));
test('title capitalizes', () => assert.strictEqual(title('abc'), 'Abc'));
test('skipped one', { skip: true }, () => {});
