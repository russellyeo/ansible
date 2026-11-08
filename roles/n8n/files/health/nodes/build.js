// ---- health-ingest "Build" node ----
// $('...') reads each node's latest run, so a retry pass sees fresh data.
const reads = $('Plan reads').all().map((i) => i.json);
const blobs = {};
if (!reads[0].none) {
  const bySha = {};
  for (const item of $('Get blob').all()) bySha[item.json.sha] = Buffer.from(item.json.content, 'base64').toString('utf8');
  for (const r of reads) {
    if (!(r.sha in bySha)) throw new Error(`${r.path}: blob wasn't fetched`);
    blobs[r.path] = bySha[r.sha];
  }
}
const tree = $('Get tree').first().json;
const { files, ledger, message } = buildCommit({
  body: $('Health Auto Export webhook').first().json.body,
  tree: tree.tree,
  blobs,
  ledger: $('Extract ledger').first().json.ledger,
  today: $now.setZone('Europe/London').toISODate(),
});
return [
  {
    json: {
      commit: files.length > 0,
      base: $('Get ref').first().json.object.sha,
      treeRequest: {
        base_tree: tree.sha,
        tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
      },
      message,
      ledger,
    },
  },
];
