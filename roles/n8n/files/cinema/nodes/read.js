// ---- cinema-collect "Read" node ----
const READERS = { picturehouse: readPicturehouse, everyman: readEverymanSchedule, bfi: readBfi };
const requests = $('Requests').all();
const first = fetchItems(FIRST_PASS);
const retried = fetchItems(RETRY_PASS);
const screenings = [];
const errors = [];
const okCinemaKeys = [];
requests.forEach((item) => {
  const { cinema } = item.json;
  const response = [first.get(cinema.key), retried.get(cinema.key)].find(itemOk);
  if (!response) {
    errors.push({ cinemaKey: cinema.key, message: `${cinema.key}: fetch failed: ${errorText(retried.get(cinema.key) || first.get(cinema.key))}` });
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
