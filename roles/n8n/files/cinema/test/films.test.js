const test = require('node:test');
const assert = require('node:assert/strict');
const { load, fixture } = require('./load.js');

const { tmdbSearchUrl, tmdbMovieUrl, omdbUrl, pickTmdbMatch, filmFromTmdb, ratingsFromOmdb, lookupPlan, mergeFilm, classify } = load(
  ['core.js', 'films.js'],
  ['tmdbSearchUrl', 'tmdbMovieUrl', 'omdbUrl', 'pickTmdbMatch', 'filmFromTmdb', 'ratingsFromOmdb', 'lookupPlan', 'mergeFilm', 'classify'],
);

const search = JSON.parse(fixture('tmdb-search-verity.json'));
const movie = JSON.parse(fixture('tmdb-movie-verity.json'));
const omdb = JSON.parse(fixture('omdb-verity.json'));

test('builds lookup URLs', () => {
  assert.equal(
    tmdbSearchUrl("Pan's Labyrinth", null),
    'https://api.themoviedb.org/3/search/movie?query=Pan\'s%20Labyrinth&include_adult=false&language=en-GB&region=GB',
  );
  assert.match(tmdbSearchUrl('Verity', 2026), /&year=2026$/);
  assert.equal(tmdbMovieUrl(1083433), 'https://api.themoviedb.org/3/movie/1083433?append_to_response=videos,external_ids&language=en-GB');
  assert.equal(omdbUrl('tt15563424'), 'https://www.omdbapi.com/?i=tt15563424');
});

test('picks the year match among same-title results', () => {
  assert.equal(pickTmdbMatch(search, { title: 'Verity', year: 2010 }), 111);
});

test('without a year picks the most popular exact title', () => {
  assert.equal(pickTmdbMatch(search, { title: 'Verity', year: null }), 1083433);
});

test('returns null when no title matches', () => {
  assert.equal(pickTmdbMatch(search, { title: 'Hope', year: null }), null);
  assert.equal(pickTmdbMatch({ results: [] }, { title: 'Verity', year: null }), null);
});

test('builds film info from TMDB', () => {
  const f = filmFromTmdb(movie);
  assert.equal(f.tmdbId, 1083433);
  assert.equal(f.imdbId, 'tt15563424');
  assert.equal(f.year, 2026);
  assert.equal(f.runtimeMin, 114);
  assert.equal(f.image, 'https://image.tmdb.org/t/p/w1280/verityBackdrop.jpg');
  assert.equal(f.trailerUrl, 'https://www.youtube.com/watch?v=trailerKey');
  assert.equal(f.originalLanguage, 'en');
  assert.equal(f.imdbRating, null);
});

test('falls back to the poster and no trailer', () => {
  const f = filmFromTmdb({ ...movie, backdrop_path: null, videos: { results: [] } });
  assert.equal(f.image, 'https://image.tmdb.org/t/p/w780/verityPoster.jpg');
  assert.equal(f.trailerUrl, null);
});

test('reads OMDb ratings and maps N/A to null', () => {
  assert.deepEqual(ratingsFromOmdb(omdb), { imdbRating: '6.8', rottenTomatoes: '71%' });
  assert.deepEqual(ratingsFromOmdb({ imdbRating: 'N/A', Ratings: [] }), { imdbRating: null, rottenTomatoes: null });
  assert.deepEqual(ratingsFromOmdb({ Response: 'False', Error: 'Incorrect IMDb ID.' }), { imdbRating: null, rottenTomatoes: null });
});

test('plans lookups from the cache', () => {
  const today = '2026-10-23';
  const row = (key, film, extra = {}) => ({ key, data: JSON.stringify(film), override_tmdb_id: '', fetched_at: '2026-10-20', ratings_at: '2026-10-20', ...extra });
  const verity = { title: 'Verity', key: 'verity|', year: null };
  const hope = { title: 'Hope', key: 'hope|', year: null };
  const tuam = { title: 'The Lost Children of Tuam', key: 'thelostchildrenoftuam|', year: null };
  const sense = { title: 'Sense and Sensibility', key: 'senseandsensibility|', year: null };
  const rows = [
    row('hope|', { tmdbId: 5, imdbId: 'tt5' }, { ratings_at: '2026-10-15' }),
    row('thelostchildrenoftuam|', { tmdbId: 6, imdbId: 'tt6' }),
    row('senseandsensibility|', { tmdbId: 7, imdbId: 'tt7' }, { override_tmdb_id: '4584' }),
  ];
  const plan = lookupPlan([verity, hope, tuam, sense], rows, today);
  assert.deepEqual(plan, [
    { key: 'verity|', title: 'Verity', year: null, tmdbId: null, need: 'full' },
    { key: 'hope|', title: 'Hope', year: null, tmdbId: 5, need: 'ratings' },
    { key: 'senseandsensibility|', title: 'Sense and Sensibility', year: null, tmdbId: 4584, need: 'full' },
  ]);
});

test('retries an unmatched film after a week', () => {
  const rows = [{ key: 'hope|', data: JSON.stringify({ tmdbId: null }), override_tmdb_id: '', fetched_at: '2026-10-10', ratings_at: '' }];
  const plan = lookupPlan([{ title: 'Hope', key: 'hope|', year: null }], rows, '2026-10-18');
  assert.equal(plan[0].need, 'full');
  assert.deepEqual(lookupPlan([{ title: 'Hope', key: 'hope|', year: null }], rows, '2026-10-12'), []);
});

test('merging with no film keeps the cinema details', () => {
  const s = { title: 'Verity', runtimeMin: 114, synopsis: 'From Everyman.', image: 'https://all.web.img.acsta.net/x.jpg', year: null };
  const f = mergeFilm(s, null);
  assert.equal(f.title, 'Verity');
  assert.equal(f.image, 'https://all.web.img.acsta.net/x.jpg');
  assert.equal(f.runtimeMin, 114);
  assert.equal(f.trailerUrl, null);
  assert.equal(mergeFilm(s, filmFromTmdb(movie)).image, 'https://image.tmdb.org/t/p/w1280/verityBackdrop.jpg');
  assert.equal(mergeFilm({ ...s, title: 'Fatherland - Preview' }, null).title, 'Fatherland');
});

test('classifies by language only when configured', () => {
  assert.equal(classify({ kind: 'captioned' }, { originalLanguage: 'ja' }), 'captioned');
  assert.equal(classify({ kind: 'subtitled' }, null), 'subtitled');
  assert.equal(classify({ kind: 'by-language' }, { originalLanguage: 'ja' }), 'subtitled');
  assert.equal(classify({ kind: 'by-language' }, { originalLanguage: 'en' }), 'captioned');
  assert.equal(classify({ kind: 'by-language' }, null), 'captioned');
});
