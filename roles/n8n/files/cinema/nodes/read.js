// ---- cinema-collect "Read" node ----
const READERS = { picturehouse: readPicturehouse, everyman: readEverymanSchedule, bfi: readBfi };
const requests = $('Requests').all();
const responses = pairResponses($('Fetch').all(), requests.length);
const retryList = $('Retry list').isExecuted ? $('Retry list').all() : [];
const retried = $('Fetch again').isExecuted ? pairResponses($('Fetch again').all(), retryList.length) : [];
const retriedByKey = new Map(retryList.map((r, i) => [r.json.key, retried[i]]));
const screenings = [];
const errors = [];
const okCinemaKeys = [];
requests.forEach((item, i) => {
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
