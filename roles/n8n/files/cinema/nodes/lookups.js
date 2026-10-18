// ---- cinema-collect "Plan lookups" node ----
const read = $('Read').first().json;
let { screenings, okCinemaKeys } = read;
const errors = [...read.errors];

if (read.everymanUrl) {
  const everymanKeys = CINEMAS.filter((c) => c.chain === 'everyman').map((c) => c.key);
  try {
    const films = $('Everyman films').isExecuted ? $('Everyman films').first() : null;
    if (!itemOk(films)) throw new Error(`film details fetch failed: ${errorText(films)}`);
    screenings = attachEverymanMovies(screenings, responseText(films));
  } catch (e) {
    for (const key of everymanKeys.filter((k) => okCinemaKeys.includes(k))) {
      errors.push({ cinemaKey: key, message: e.message.startsWith(`${key}:`) ? e.message : `${key}: ${e.message}` });
    }
    screenings = screenings.filter((s) => !everymanKeys.includes(s.cinemaKey));
    okCinemaKeys = okCinemaKeys.filter((k) => !everymanKeys.includes(k));
  }
}

const filmList = [];
const seen = new Set();
for (const s of screenings) {
  const key = filmKey(s);
  if (seen.has(key)) continue;
  seen.add(key);
  filmList.push({ key, title: normaliseTitle(s.title).title, year: s.year });
}
const cacheRows = $('Load film cache').all().map((i) => i.json).filter((r) => r.key);
const plan = lookupPlan(filmList, cacheRows, londonToday());
return [{ json: { screenings, errors, okCinemaKeys, plan } }];
