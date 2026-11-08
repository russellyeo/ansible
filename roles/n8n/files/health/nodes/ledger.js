// ---- health-ingest "Save ledger" node ----
const ledger = $('Build').first().json.ledger;
const data = await this.helpers.prepareBinaryData(Buffer.from(JSON.stringify(ledger, null, 2), 'utf8'), 'ledger.json', 'application/json');
return [{ json: {}, binary: { data } }];
