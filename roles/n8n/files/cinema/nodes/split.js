// ---- cinema-collect "POST requests" / "GET requests" nodes (METHOD) ----
return $('Requests').all()
  .filter((item) => item.json.request.method === METHOD)
  .map((item) => ({ json: { key: item.json.cinema.key, request: item.json.request } }));
