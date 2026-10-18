// Loads cinema files the way the n8n Code nodes see them: concatenated into
// one script. The files have no require/module.exports of their own.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function load(files, names) {
  const code = files.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  return new Function(`${code}\nreturn { ${names.join(', ')} };`)();
}

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

module.exports = { load, fixture };
