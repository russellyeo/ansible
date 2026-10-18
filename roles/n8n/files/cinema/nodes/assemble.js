// ---- cinema-collect "Assemble" node ----
const today = londonToday();
const { screenings, errors, okCinemaKeys, plan } = $('Plan lookups').first().json;
const searches = sideResults('Search requests', 'TMDB search');
const movies = sideResults('Movie requests', 'TMDB movie');
const ratings = sideResults('OMDb requests', 'OMDb');
const cacheRows = $('Load film cache').all().map((i) => i.json).filter((r) => r.key);
const rows = new Map(cacheRows.map((r) => [r.key, r]));
const statusRows = $('Load status').all().map((i) => i.json).filter((r) => r.cinema_key);

const films = {};
for (const r of cacheRows) films[r.key] = JSON.parse(r.data || 'null');

const cacheRowsToSave = [];
for (const p of plan) {
  const row = rows.get(p.key);
  let film = row ? JSON.parse(row.data || 'null') : null;
  if (p.need === 'full') {
    if (movies.has(p.key)) {
      const movie = movies.get(p.key);
      if (!movie || !movie.id) continue; // TMDB hiccup: try again next run
      film = filmFromTmdb(movie);
    } else {
      if (!p.tmdbId && searches.get(p.key) === undefined) continue; // search failed
      film = { ...emptyFilm(), title: p.title }; // no TMDB match
    }
  }
  const omdb = ratings.get(p.key);
  if (omdb && film) Object.assign(film, ratingsFromOmdb(omdb));
  films[p.key] = film;
  cacheRowsToSave.push({
    key: p.key,
    data: JSON.stringify(film),
    override_tmdb_id: (row && row.override_tmdb_id) || '',
    fetched_at: p.need === 'full' ? today : (row && row.fetched_at) || today,
    ratings_at: omdb ? today : (row && row.ratings_at) || '',
  });
}

return [
  {
    json: {
      screenings,
      films,
      errors,
      okCinemaKeys,
      statusRows,
      cacheRowsToSave,
      statusRowsToSave: statusUpdates({ screenings, okCinemaKeys, statusRows, today }),
    },
  },
];
