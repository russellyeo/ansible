// ---- cinema-sync "Plan" node ----
const { screenings, films, errors, okCinemaKeys } = $('Collect').first().json;
const cinemas = new Map(CINEMAS.map((c) => [c.key, c]));
const wanted = screenings
  .filter((s) => cinemas.has(s.cinemaKey))
  .map((s) => ({ screening: s, film: mergeFilm(s, films[filmKey(s)] || null), cinema: cinemas.get(s.cinemaKey) }))
  .filter((w) => classify(w.screening, w.film) === 'captioned' && fitsFreeHours(w.screening.start, FREE_HOURS));
const now = $now.setZone('Europe/London').toFormat("yyyy-MM-dd'T'HH:mm");
const events = $('List events').first().json.items || [];
const plan = planSync({ wanted, events, okCinemaKeys, now });
const executionUrl = `${N8N_URL}/workflow/${$workflow.id}/executions/${$execution.id}`;
const alert = errors.length || plan.capped.length ? buildAlert({ errors, capped: plan.capped, cinemas: CINEMAS, executionUrl }) : null;
return [
  {
    json: {
      ops: calendarOps(plan),
      alert,
      summary: { wanted: wanted.length, create: plan.create.length, update: plan.update.length, remove: plan.remove.length, capped: plan.capped, errors: errors.length },
    },
  },
];
