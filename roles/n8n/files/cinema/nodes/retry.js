// ---- cinema-collect "Retry POST" / "Retry GET" nodes (METHOD) ----
// Failed fetches get one more try after a 60s wait (Cloudflare 5xx answers
// ask for that back-off). The HTTP node's own retries don't cover error statuses.
const first = fetchItems(FIRST_PASS);
return $('Requests').all()
  .filter((item) => item.json.request.method === METHOD && !itemOk(first.get(item.json.cinema.key)))
  .map((item) => ({ json: { key: item.json.cinema.key, request: item.json.request } }));
