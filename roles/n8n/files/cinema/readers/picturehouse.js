// Picturehouse: POST /api/scheduled-movies-ajax (see cinemaRequest).
// HOHSub = "Subtitled (Captioned)" for deaf/HoH audiences; "Sub Cinema" =
// foreign-language with English subtitles.

const PH_CAPTIONED = 'HOHSub';
const PH_SUBTITLED = 'Sub Cinema';
const SHOWTIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function readPicturehouse(text, cinema) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ReaderError(cinema.key, `response is not JSON: ${String(text).slice(0, 80)}`);
  }
  if (!data || data.response !== 'success' || !Array.isArray(data.movies)) {
    throw new ReaderError(cinema.key, `unexpected response: ${JSON.stringify(data).slice(0, 80)}`);
  }

  const screenings = [];
  let flagsSeen = false;
  for (const movie of data.movies) {
    for (const session of movie.show_times || []) {
      const attrs = session.SessionAttributesNames || [];
      const captioned = attrs.includes(PH_CAPTIONED);
      const subtitled = attrs.includes(PH_SUBTITLED);
      if (!captioned && !subtitled) continue;
      flagsSeen = true;
      if (!SHOWTIME_RE.test(session.Showtime || '')) {
        throw new ReaderError(cinema.key, `unreadable showtime ${JSON.stringify(session.Showtime)} for ${movie.Title}`);
      }
      screenings.push({
        cinemaKey: cinema.key,
        sourceId: String(session.SessionId),
        title: movie.Title,
        start: session.Showtime.slice(0, 16),
        screen: session.ScreenName || null,
        bookingUrl: `https://web.picturehouses.com/order/showtimes/${session.CinemaId}-${session.SessionId}/seats`,
        kind: captioned ? 'captioned' : 'subtitled',
        year: null,
        runtimeMin: null,
        synopsis: null,
        image: movie.image_url ? movie.image_url.replace('width=640&height=360', 'width=1280&height=720') : null,
        chainFilmId: movie.ScheduledFilmId || null,
      });
    }
  }
  // "Sub Cinema" is always on the listings in practice; losing both flags
  // means Picturehouse renamed them, not a quiet fortnight.
  if (!flagsSeen) throw new ReaderError(cinema.key, 'no HOHSub or Sub Cinema sessions; attribute names may have changed');
  return screenings;
}
