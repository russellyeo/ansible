// Everyman (Webedia/Boxoffice platform): the schedule endpoint gives
// showtimes keyed by film ID; a second call to the movies endpoint gives the
// titles and details.

const EM_CAPTIONED = 'Showtime.Accessibility.ClosedCaption';
const EM_API = 'https://www.everymancinema.com/api/gatsby-source-boxofficeapi';

function parseEverymanJson(text, cinemaKey) {
  try {
    return JSON.parse(text);
  } catch {
    throw new ReaderError(cinemaKey, `response is not JSON: ${String(text).slice(0, 80)}`);
  }
}

function readEverymanSchedule(text, cinema) {
  const data = parseEverymanJson(text, cinema.key);
  const schedule = data && data[cinema.chain_id] && data[cinema.chain_id].schedule;
  if (!schedule || typeof schedule !== 'object') {
    throw new ReaderError(cinema.key, `no schedule for theatre ${cinema.chain_id}`);
  }
  const screenings = [];
  for (const [movieId, days] of Object.entries(schedule)) {
    for (const showtimes of Object.values(days)) {
      for (const st of showtimes) {
        if (!(st.tags || []).includes(EM_CAPTIONED)) continue;
        if (!SHOWTIME_RE.test(st.startsAt || '')) {
          throw new ReaderError(cinema.key, `unreadable showtime ${JSON.stringify(st.startsAt)} for film ${movieId}`);
        }
        const ticketing = ((st.data && st.data.ticketing) || []).find((t) => t.provider === 'default');
        screenings.push({
          cinemaKey: cinema.key,
          sourceId: st.id,
          title: null,
          start: st.startsAt.slice(0, 16),
          screen: (st.data && st.data.screen && st.data.screen.name) || null,
          bookingUrl: (ticketing && ticketing.urls && ticketing.urls[0]) || null,
          kind: 'captioned',
          year: null,
          runtimeMin: null,
          synopsis: null,
          image: null,
          chainFilmId: movieId,
        });
      }
    }
  }
  return screenings;
}

function everymanMoviesUrl(screenings) {
  const ids = [...new Set(screenings.filter((s) => s.title === null && s.chainFilmId).map((s) => s.chainFilmId))];
  if (!ids.length) return null;
  return `${EM_API}/movies?${ids.map((id) => `ids=${encodeURIComponent(id)}`).join('&')}`;
}

// Fills title and details on Everyman screenings (those still untitled).
function attachEverymanMovies(screenings, moviesText) {
  const movies = parseEverymanJson(moviesText, 'everyman');
  const byId = new Map((Array.isArray(movies) ? movies : []).map((m) => [String(m.id), m]));
  return screenings.map((s) => {
    if (s.title !== null) return s;
    const m = byId.get(s.chainFilmId);
    if (!m || !m.title) throw new ReaderError(s.cinemaKey, `film ${s.chainFilmId} missing from the movies response`);
    return {
      ...s,
      title: m.title,
      runtimeMin: m.runtime ? Math.round(m.runtime / 60) : null,
      synopsis: (m.locale && m.locale.synopsis) || null,
      image: (m.images && m.images[0] && m.images[0].url) || m.poster || null,
    };
  });
}
