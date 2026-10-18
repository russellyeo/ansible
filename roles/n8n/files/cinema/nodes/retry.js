// ---- cinema-collect "Retry list" node ----
// Failed fetches get one more try after "Wait" (60s: Cloudflare 5xx answers
// ask for that back-off). The HTTP node's own retries don't cover error statuses.
const requests = $('Requests').all();
const responses = pairResponses($('Fetch').all(), requests.length);
return requests
  .filter((item, i) => !itemOk(responses[i]))
  .map((item) => ({ json: { key: item.json.cinema.key, request: item.json.request } }));
