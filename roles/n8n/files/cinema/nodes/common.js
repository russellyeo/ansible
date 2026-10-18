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

// One response per request, matched through pairedItem rather than position:
// an HTTP node turns a JSON array answer into one item per element (or none
// for []), which would shift every later response onto the wrong request.
function pairResponses(responses, count) {
  const byInput = Array.from({ length: count }, () => []);
  for (const r of responses) {
    const p = Array.isArray(r.pairedItem) ? r.pairedItem[0] : r.pairedItem;
    const i = p && typeof p.item === 'number' ? p.item : -1;
    if (i >= 0 && i < count) byInput[i].push(r);
  }
  return byInput.map((list) => {
    if (list.length === 1) return list[0];
    return { json: { error: list.length ? 'unexpected array response' : 'no response' } };
  });
}

// Map of request key -> response item, pairing a request node's items with
// the HTTP node that sent them. Empty when that branch didn't run.
function sideItems(requestNode, httpNode) {
  const items = new Map();
  if (!$(requestNode).isExecuted || !$(httpNode).isExecuted) return items;
  const requests = $(requestNode).all();
  const responses = pairResponses($(httpNode).all(), requests.length);
  requests.forEach((req, i) => items.set(req.json.key, responses[i]));
  return items;
}

// Map of request key -> response json (undefined when that request failed).
function sideResults(requestNode, httpNode) {
  return new Map([...sideItems(requestNode, httpNode)].map(([key, item]) => [key, itemOk(item) ? item.json : undefined]));
}

// Cinema fetches go through a POST node (JSON body) or a GET node (no body).
const FIRST_PASS = [['POST requests', 'Fetch POST'], ['GET requests', 'Fetch GET']];
const RETRY_PASS = [['Retry POST', 'Fetch again POST'], ['Retry GET', 'Fetch again GET']];

function fetchItems(pass) {
  return new Map(pass.flatMap(([requestNode, httpNode]) => [...sideItems(requestNode, httpNode)]));
}

// The response body as text: JSON responses arrive parsed, text ones in data.
function responseText(item) {
  return typeof item.json.data === 'string' ? item.json.data : JSON.stringify(item.json);
}
