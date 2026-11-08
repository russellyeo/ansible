// ---- health-ingest "Plan reads" node ----
// Input: "Get tree". One item per note Build needs to read, or a single
// { none: true } so the flow carries on when there's nothing to read.
const { tree, truncated } = $input.first().json;
if (truncated) throw new Error('GitHub tree listing was truncated');
const reads = planReads({
  body: $('Health Auto Export webhook').first().json.body,
  tree,
  ledger: $('Extract ledger').first().json.ledger,
  today: $now.setZone('Europe/London').toISODate(),
});
return reads.length ? reads.map((r) => ({ json: r })) : [{ json: { none: true } }];
