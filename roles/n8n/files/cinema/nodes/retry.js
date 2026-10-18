// ---- cinema-collect "Retry list" node ----
// Failed fetches get one more try after "Wait" (Cloudflare 5xx and timeouts
// are usually brief). The HTTP node's own retries don't cover error statuses.
const responses = $('Fetch').all();
return $('Requests').all()
  .filter((item, i) => !itemOk(responses[i]))
  .map((item) => ({ json: { key: item.json.cinema.key, request: item.json.request } }));
