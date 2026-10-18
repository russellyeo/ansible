// ---- cinema-collect "OMDb requests" node ----
const { plan } = $('Plan lookups').first().json;
const movies = sideResults('Movie requests', 'TMDB movie');
const rows = new Map($('Load film cache').all().map((i) => [i.json.key, i.json]));
return plan
  .map((p) => {
    const movie = movies.get(p.key);
    const cached = rows.has(p.key) ? JSON.parse(rows.get(p.key).data || '{}') : {};
    const imdbId = (movie && movie.external_ids && movie.external_ids.imdb_id) || (p.need === 'ratings' && cached.imdbId) || null;
    return imdbId ? { json: { key: p.key, url: omdbUrl(imdbId) } } : null;
  })
  .filter(Boolean);
