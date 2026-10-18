// ---- cinema-collect "Search requests" node ----
const { plan } = $('Plan lookups').first().json;
return plan.filter((p) => !p.tmdbId).map((p) => ({ json: { key: p.key, url: tmdbSearchUrl(p.title, p.year) } }));
