// Runs each Code node script the way n8n does: health.js prepended, as the
// body of an async function with n8n's globals. Every payload here is made up.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

// A fixed $now with the Luxon calls the nodes use.
const now = {
  toFormat: () => '2026-11-08-091500',
  toISO: () => '2026-11-08T09:15:00.000+00:00',
  setZone: () => ({ toISODate: () => '2026-11-08' }),
};

function runNode(name, { input = [], nodes = {}, runIndex = 0 } = {}) {
  const code = `${fs.readFileSync(path.join(ROOT, 'health.js'), 'utf8')}\n${fs.readFileSync(path.join(ROOT, 'nodes', name), 'utf8')}`;
  const items = (list) => ({ all: () => list, first: () => list[0] });
  const $ = (node) => {
    if (!(node in nodes)) throw new Error(`node ${node} not stubbed`);
    return items(nodes[node]);
  };
  const helpers = {
    prepareBinaryData: async (buffer, fileName, mimeType) => ({ data: buffer.toString('base64'), fileName, mimeType }),
  };
  const fn = new AsyncFunction('$input', '$', '$now', '$runIndex', code);
  return fn.call({ helpers }, items(input), $, now, runIndex);
}

const binaryJson = (item) => JSON.parse(Buffer.from(item.binary.data.data, 'base64').toString('utf8'));

const workout = {
  id: 'AAAA-1111', name: 'Traditional Strength Training', start: '2026-11-04 13:35:22 +0000',
  end: '2026-11-04 14:11:06 +0000', duration: 2144, source: { name: 'Hevy' },
};
const webhook = (body) => ({ 'Health Auto Export webhook': [{ json: { body } }] });

test('Prepare emits one archive file per item, as binary', async () => {
  const out = await runNode('prepare.js', { input: [{ json: { body: { data: { workouts: [workout] } } } }] });
  assert.deepEqual(out.map((i) => i.json.path), ['workouts/AAAA-1111.json', 'last-payload.json']);
  assert.deepEqual(binaryJson(out[0]), workout);
  assert.equal(out[1].binary.data.fileName, 'last-payload.json');
});

test('Plan reads emits a placeholder when there is nothing to read', async () => {
  const out = await runNode('plan.js', {
    input: [{ json: { sha: 't', tree: [], truncated: false } }],
    nodes: { ...webhook({ data: { workouts: [workout] } }), 'Extract ledger': [{ json: { ledger: { workouts: {} } } }] },
  });
  assert.deepEqual(out, [{ json: { none: true } }]);
});

test('Plan reads refuses a truncated tree', async () => {
  await assert.rejects(
    runNode('plan.js', {
      input: [{ json: { sha: 't', tree: [], truncated: true } }],
      nodes: { ...webhook({ data: { workouts: [] } }), 'Extract ledger': [{ json: { ledger: {} } }] },
    }),
    /tree listing was truncated/,
  );
});

test('Build decodes blobs by sha and asks for no commit when nothing changed', async () => {
  const notePath = 'workouts/2026/2026-11-04 1335 Strength.md';
  const text = `---\ntype: workout\nsource_id: AAAA-1111\n---\n`;
  const out = await runNode('build.js', {
    nodes: {
      ...webhook({ data: { workouts: [workout] } }),
      'Extract ledger': [{ json: { ledger: { workouts: {} } } }],
      'Get ref': [{ json: { object: { sha: 'commit-1' } } }],
      'Get tree': [{ json: { sha: 'tree-1', tree: [{ path: notePath, type: 'blob', sha: 'blob-1' }] } }],
      'Plan reads': [{ json: { path: notePath, sha: 'blob-1' } }],
      'Get blob': [{ json: { sha: 'blob-1', content: Buffer.from(text).toString('base64'), encoding: 'base64' } }],
    },
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].json.commit, false);
  assert.deepEqual(out[0].json.ledger, { workouts: { 'AAAA-1111': notePath } });
  assert.equal(out[0].json.base, 'commit-1');
});

test('Build makes the tree request for new notes', async () => {
  const out = await runNode('build.js', {
    nodes: {
      ...webhook({ data: { workouts: [workout] } }),
      'Extract ledger': [{ json: { ledger: { workouts: {} } } }],
      'Get ref': [{ json: { object: { sha: 'commit-1' } } }],
      'Get tree': [{ json: { sha: 'tree-1', tree: [] } }],
      'Plan reads': [{ json: { none: true } }],
    },
  });
  const { commit, treeRequest, message } = out[0].json;
  assert.equal(commit, true);
  assert.equal(treeRequest.base_tree, 'tree-1');
  assert.deepEqual(Object.keys(treeRequest.tree[0]), ['path', 'mode', 'type', 'content']);
  assert.equal(treeRequest.tree[0].mode, '100644');
  assert.equal(message, 'Health Auto Export: 1 workout, 0 days');
});

test('Retry guard gives up on the fifth failed update', async () => {
  const input = [{ json: { statusCode: 422 } }];
  assert.deepEqual(await runNode('retry.js', { input, runIndex: 3 }), input);
  await assert.rejects(runNode('retry.js', { input, runIndex: 4 }), /gave up after 5 tries/);
});

test('Save ledger writes the built ledger as binary', async () => {
  const ledger = { workouts: { 'AAAA-1111': 'workouts/x.md' } };
  const out = await runNode('ledger.js', { nodes: { Build: [{ json: { ledger } }] } });
  assert.deepEqual(binaryJson(out[0]), ledger);
});

test('Staleness check flags 3 days without a payload', async () => {
  const stale = (received) => runNode('stale.js', { input: [{ json: { data: { received, kind: 'metrics' } } }] });
  assert.deepEqual((await stale('2026-11-05T09:15:00.000+00:00'))[0].json, { stale: true, days: 3 });
  assert.deepEqual((await stale('2026-11-05T09:16:00.000+00:00'))[0].json, { stale: false, days: 2 });
});

test('Save ledger writes nothing for a metrics payload', async () => {
  assert.deepEqual(await runNode('ledger.js', { nodes: { Build: [{ json: { ledger: null } }] } }), []);
});
