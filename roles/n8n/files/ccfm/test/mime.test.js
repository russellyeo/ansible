const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMime } = require('../ccfm.js');

const PNG = Buffer.from('fake image bytes').toString('base64');

function decode(raw) {
  return Buffer.from(raw, 'base64url').toString('utf8');
}

test('builds a base64url message with text, html and an inline image', () => {
  const raw = buildMime({
    to: 'me@example.com',
    subject: "📍 Moved! Ally Pally Farmers' Market – Sunday",
    text: 'plain body',
    html: '<p>html body</p><img src="cid:park">',
    images: [{ cid: 'park', contentType: 'image/jpeg', base64: PNG }],
  });
  assert.match(raw, /^[A-Za-z0-9_-]+$/);
  const msg = decode(raw);
  assert.match(msg, /^To: me@example\.com\r\n/m);
  const subject = msg.match(/^Subject: =\?UTF-8\?B\?([^?]+)\?=\r$/m);
  assert.ok(subject, 'subject is RFC 2047 encoded');
  assert.equal(Buffer.from(subject[1], 'base64').toString('utf8'), "📍 Moved! Ally Pally Farmers' Market – Sunday");
  assert.match(msg, /Content-Type: multipart\/related; boundary=/);
  assert.match(msg, /Content-Type: multipart\/alternative; boundary=/);
  assert.match(msg, /Content-ID: <park>/);
  assert.match(msg, /Content-Disposition: inline; filename="park\.jpg"/);
  assert.ok(msg.includes(PNG));
  assert.ok(msg.includes(Buffer.from('plain body').toString('base64')));
  assert.ok(msg.includes(Buffer.from('<p>html body</p><img src="cid:park">').toString('base64')));
});

test('builds a message without images', () => {
  const msg = decode(buildMime({ to: 'me@example.com', subject: 'Hi', text: 't', html: '<p>h</p>', images: [] }));
  assert.doesNotMatch(msg, /Content-ID/);
  assert.match(msg, /multipart\/alternative/);
});
