// ---- health-ingest "Prepare" node ----
// One item per archive file, with the file as binary for "Write archive".
const body = $input.first().json.body;
const files = archiveFiles(body, $now.toFormat('yyyy-LL-dd-HHmmss'), $now.toISO());
const items = [];
for (const f of files) {
  const name = f.path.split('/').pop();
  const data = await this.helpers.prepareBinaryData(Buffer.from(f.content, 'utf8'), name, 'application/json');
  items.push({ json: { path: f.path }, binary: { data } });
}
return items;
