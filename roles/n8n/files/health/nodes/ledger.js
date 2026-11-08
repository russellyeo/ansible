// ---- health-ingest "Save ledger" node ----
// Only workouts payloads change the ledger; a metrics run writes nothing.
const ledger = $('Build').first().json.ledger;
if (ledger === null) return [];
const data = await this.helpers.prepareBinaryData(Buffer.from(JSON.stringify(ledger, null, 2), 'utf8'), 'ledger.json', 'application/json');
return [{ json: {}, binary: { data } }];
