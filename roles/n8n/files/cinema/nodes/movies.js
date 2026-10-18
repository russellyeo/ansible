// ---- cinema-collect "Movie requests" node ----
const { plan } = $('Plan lookups').first().json;
const searches = sideResults('Search requests', 'TMDB search');
return plan
  .filter((p) => p.need === 'full')
  .map((p) => ({ p, id: p.tmdbId || (searches.get(p.key) ? pickTmdbMatch(searches.get(p.key), p) : null) }))
  .filter(({ id }) => id)
  .map(({ p, id }) => ({ json: { key: p.key, url: tmdbMovieUrl(id) } }));
