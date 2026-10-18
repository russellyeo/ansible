const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

const { pairResponses } = load(['nodes/common.js'], ['pairResponses']);

const out = (input, json) => ({ json, pairedItem: { item: input } });

test('pairs responses with their requests by input index', () => {
  const paired = pairResponses([out(0, { a: 1 }), out(2, { c: 3 }), out(1, { b: 2 })], 3);
  assert.deepEqual(paired.map((p) => p.json), [{ a: 1 }, { b: 2 }, { c: 3 }]);
});

test('a request with no response is an error, not the next response', () => {
  // An empty JSON array answer gives zero output items for request 0.
  const paired = pairResponses([out(1, { b: 2 }), out(2, { c: 3 })], 3);
  assert.ok(paired[0].json.error);
  assert.deepEqual(paired[1].json, { b: 2 });
  assert.deepEqual(paired[2].json, { c: 3 });
});

test('a request answered with several items (a JSON array) is an error', () => {
  const paired = pairResponses([out(0, { x: 1 }), out(0, { x: 2 }), out(1, { b: 2 })], 2);
  assert.match(String(paired[0].json.error), /array/);
  assert.deepEqual(paired[1].json, { b: 2 });
});
