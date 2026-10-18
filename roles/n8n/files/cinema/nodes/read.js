// ---- cinema-collect "Read" node ----
const READERS = { picturehouse: readPicturehouse, everyman: readEverymanSchedule, bfi: readBfi };
const responses = $('Fetch').all();
const retried = $('Fetch again').isExecuted ? $('Fetch again').all() : [];
const retriedByKey = new Map($('Retry list').isExecuted ? $('Retry list').all().map((r, i) => [r.json.key, retried[i]]) : []);
const screenings = [];
const errors = [];
const okCinemaKeys = [];
$('Requests').all().forEach((item, i) => {
  const { cinema } = item.json;
  const response = [responses[i], retriedByKey.get(cinema.key)].find(itemOk);
  if (!response) {
    errors.push({ cinemaKey: cinema.key, message: `${cinema.key}: fetch failed: ${errorText(retriedByKey.get(cinema.key) || responses[i])}` });
    return;
  }
  try {
    screenings.push(...READERS[cinema.chain](responseText(response), cinema));
    okCinemaKeys.push(cinema.key);
  } catch (e) {
    errors.push({ cinemaKey: cinema.key, message: e.message });
  }
});
return [{ json: { screenings, errors, okCinemaKeys, everymanUrl: everymanMoviesUrl(screenings) } }];
