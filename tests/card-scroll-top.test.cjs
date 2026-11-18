'use strict';
// mindfeed#5: a card taller than the stage must be scrollable to its top at any length.
const {test} = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'web', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = sel => (css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&') + '\\s*\\{([^}]*)\\}')) || [])[1] || '';
test('stage never centres with justify-content (overflow above the top is unreachable)', () => {
  assert.ok(rule('.stage'), 'missing .stage rule');
  assert.doesNotMatch(rule('.stage'), /justify-content\s*:\s*center/);
  assert.doesNotMatch(css, /\.stage:has\(/, 'no length-specific stage special case');
});
test('cards are centred with auto margins and keep their full height', () => {
  const r = rule('.stage > *');
  assert.match(r, /margin-block\s*:\s*auto/);
  assert.match(r, /flex\s*:\s*none/);
  assert.match(rule('.stage'), /overflow-y\s*:\s*auto/);
});
