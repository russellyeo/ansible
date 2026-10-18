// ---- cinema-digest "Build digest" node ----
const { screenings, films, errors, statusRows } = $('Collect').first().json;
const today = londonToday();
return [
  {
    json: buildDigest({
      today,
      screenings,
      films,
      cinemas: CINEMAS,
      errors,
      notes: staleNotes({ statusRows, today, cinemas: CINEMAS }),
      hours: FREE_HOURS,
    }),
  },
];
