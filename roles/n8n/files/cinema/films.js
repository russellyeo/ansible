// Film info: TMDB (image, synopsis, runtime, trailer, IMDb ID, language) and
// OMDb (IMDb and Rotten Tomatoes ratings), cached in the cinema_films data
// table. API keys come from the n8n credentials, not from here.
//
// A film: { tmdbId, imdbId, title, year, synopsis, runtimeMin, image,
//           trailerUrl, originalLanguage, imdbRating, rottenTomatoes }

const TMDB_API = 'https://api.themoviedb.org/3';
const TMDB_IMAGES = 'https://image.tmdb.org/t/p';
const RATINGS_MAX_AGE_DAYS = 7;
const UNMATCHED_RETRY_DAYS = 7;

function emptyFilm() {
  return {
    tmdbId: null, imdbId: null, title: null, year: null, synopsis: null, runtimeMin: null,
    image: null, trailerUrl: null, originalLanguage: null, imdbRating: null, rottenTomatoes: null,
  };
}

function tmdbSearchUrl(title, year) {
  const yearParam = year ? `&year=${year}` : '';
  return `${TMDB_API}/search/movie?query=${encodeURIComponent(title)}&include_adult=false&language=en-GB&region=GB${yearParam}`;
}

function tmdbMovieUrl(id) {
  return `${TMDB_API}/movie/${id}?append_to_response=videos,external_ids&language=en-GB`;
}

function omdbUrl(imdbId) {
  return `https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}`;
}

function releaseYear(date) {
  const y = /^(\d{4})/.exec(date || '');
  return y ? Number(y[1]) : null;
}

function pickTmdbMatch(searchJson, { title, year }) {
  const want = normaliseTitle(title).key;
  const candidates = ((searchJson && searchJson.results) || []).filter(
    (r) => normaliseTitle(r.title || '').key === want || normaliseTitle(r.original_title || '').key === want,
  );
  if (!candidates.length) return null;
  const byYear = year ? candidates.filter((r) => releaseYear(r.release_date) === year) : [];
  const pool = byYear.length ? byYear : candidates;
  return [...pool].sort((a, b) => (b.popularity || 0) - (a.popularity || 0))[0].id;
}

function filmFromTmdb(m) {
  const trailer = ((m.videos && m.videos.results) || []).find((v) => v.site === 'YouTube' && v.type === 'Trailer');
  let image = null;
  if (m.backdrop_path) image = `${TMDB_IMAGES}/w1280${m.backdrop_path}`;
  else if (m.poster_path) image = `${TMDB_IMAGES}/w780${m.poster_path}`;
  return {
    ...emptyFilm(),
    tmdbId: m.id,
    imdbId: (m.external_ids && m.external_ids.imdb_id) || m.imdb_id || null,
    title: m.title || null,
    year: releaseYear(m.release_date),
    synopsis: m.overview || null,
    runtimeMin: m.runtime || null,
    image,
    trailerUrl: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
    originalLanguage: m.original_language || null,
  };
}

function ratingsFromOmdb(json) {
  const value = (v) => (v && v !== 'N/A' ? v : null);
  const rt = ((json && json.Ratings) || []).find((r) => r.Source === 'Rotten Tomatoes');
  return { imdbRating: value(json && json.imdbRating), rottenTomatoes: value(rt && rt.Value) };
}

function daysBetween(fromIso, toIso) {
  return Math.round((utcDate(toIso) - utcDate(fromIso)) / 86400000);
}

// films: [{key, title, year}] for every film on the listings.
function lookupPlan(films, cacheRows, today) {
  const rows = new Map((cacheRows || []).filter((r) => r && r.key).map((r) => [r.key, r]));
  const plan = [];
  for (const { key, title, year } of films) {
    const row = rows.get(key);
    const cached = row ? JSON.parse(row.data || '{}') : null;
    const override = row && row.override_tmdb_id ? Number(row.override_tmdb_id) : null;
    if (!row) {
      plan.push({ key, title, year, tmdbId: null, need: 'full' });
    } else if (override && override !== cached.tmdbId) {
      plan.push({ key, title, year, tmdbId: override, need: 'full' });
    } else if (!cached.tmdbId) {
      if (!row.fetched_at || daysBetween(row.fetched_at, today) >= UNMATCHED_RETRY_DAYS) {
        plan.push({ key, title, year, tmdbId: null, need: 'full' });
      }
    } else if (!row.ratings_at || daysBetween(row.ratings_at, today) >= RATINGS_MAX_AGE_DAYS) {
      plan.push({ key, title, year, tmdbId: cached.tmdbId, need: 'ratings' });
    }
  }
  return plan;
}

// The film as the emails and calendar show it: TMDB first, the cinema's own
// details for anything TMDB lacks.
function mergeFilm(screening, film) {
  const f = film || emptyFilm();
  return {
    ...emptyFilm(),
    ...f,
    title: f.title || normaliseTitle(screening.title).title,
    year: f.year || screening.year || null,
    synopsis: f.synopsis || screening.synopsis || null,
    runtimeMin: f.runtimeMin || screening.runtimeMin || null,
    image: f.image || screening.image || null,
  };
}

function classify(screening, film) {
  if (screening.kind !== 'by-language') return screening.kind;
  const lang = film && film.originalLanguage;
  return lang && lang !== 'en' ? 'subtitled' : 'captioned';
}
