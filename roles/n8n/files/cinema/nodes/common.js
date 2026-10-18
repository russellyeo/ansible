// ---- shared by the cinema Code nodes ----
// HTTP nodes run with onError: continueRegularOutput, so a request that still
// fails after its retries comes out as an item with json.error. Lookups run
// in side branches that may not run at all (no requests), so read them with
// sideResults.
function itemOk(item) {
  return Boolean(item && item.json && !item.json.error);
}

function errorText(item) {
  const err = item && item.json && item.json.error;
  if (!err) return 'no response';
  const text = typeof err === 'string' ? err : err.message || JSON.stringify(err);
  // n8n appends the response body ("502 - {...json...}"); keep the status and
  // the body's title (Cloudflare's "Error 502: Bad gateway").
  const title = /"title":"([^"]+)"/.exec(text);
  const head = text.replace(/\s-\s[{<[][\s\S]*$/, '');
  const short = title ? `${head} (${title[1]})` : head;
  return short.length > 200 ? `${short.slice(0, 200)}…` : short;
}

function londonToday() {
  return $now.setZone('Europe/London').toISODate();
}

// Map of request key -> response json (undefined when that request failed),
// pairing a request node's items with the HTTP node that sent them.
function sideResults(requestNode, httpNode) {
  const results = new Map();
  if (!$(httpNode).isExecuted) return results;
  const responses = $(httpNode).all();
  $(requestNode).all().forEach((req, i) => results.set(req.json.key, itemOk(responses[i]) ? responses[i].json : undefined));
  return results;
}

// The response body as text: JSON responses arrive parsed, text ones in data.
function responseText(item) {
  return typeof item.json.data === 'string' ? item.json.data : JSON.stringify(item.json);
}
