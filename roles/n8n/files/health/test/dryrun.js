// Builds notes from real Health Auto Export payloads and checks them with the
// vault's validator, printing only counts and error lines, never values.
//
//   node roles/n8n/files/health/test/dryrun.js <payload.json>... --today YYYY-MM-DD [--out DIR]
//
// --out writes the notes into DIR (keep it outside any repo). The payloads
// are health data: keep them on the NAS or in a scratch folder.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { load } = require('./load.js');

const { buildCommit } = load(['health.js'], ['buildCommit']);
const VAULT = process.env.HEALTH_VAULT || path.join(os.homedir(), 'Developer/Obsidian/apple-health-vault');

async function main(argv) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    if (i === -1) return null;
    const [value] = argv.splice(i, 2).slice(1);
    return value;
  };
  const today = flag('--today');
  const out = flag('--out');
  if (!today || argv.length === 0) throw new Error('usage: dryrun.js <payload.json>... --today YYYY-MM-DD [--out DIR]');

  const { parseNote, validateNote } = await import(pathToFileURL(path.join(VAULT, 'scripts/validate.mjs')).href);
  const schema = JSON.parse(fs.readFileSync(path.join(VAULT, 'schema/v1.json'), 'utf8'));

  const files = argv.flatMap((file) => {
    const body = JSON.parse(fs.readFileSync(file, 'utf8'));
    return buildCommit({ body, tree: [], blobs: {}, ledger: {}, today }).files;
  });
  let errors = 0;
  for (const f of files) {
    for (const error of validateNote(parseNote(f.content).data, schema)) {
      console.log(`${f.path}: ${error}`);
      errors++;
    }
    if (out) {
      fs.mkdirSync(path.dirname(path.join(out, f.path)), { recursive: true });
      fs.writeFileSync(path.join(out, f.path), f.content);
    }
  }
  const count = (prefix) => files.filter((f) => f.path.startsWith(prefix)).length;
  console.log(`${files.length} notes (${count('workouts/')} workouts, ${count('days/')} days), ${errors} errors`);
  process.exitCode = errors ? 1 : 0;
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
