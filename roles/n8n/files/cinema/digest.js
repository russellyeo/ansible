// The Friday digest and the sync's alert email.

const DIGEST_NAME = 'Subtitled Cinema Screenings';
const CALENDAR_URL = 'https://calendar.google.com/calendar/u/0/r';
const STALE_DAYS = 28;
const DIGEST_SYNOPSIS_CHARS = 300;
const ACCENT = '#8a2be2';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cinemaName(cinemas, key) {
  const c = cinemas.find((x) => x.key === key);
  return c ? c.name : key;
}

function runtimeText(min) {
  if (!min) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

function metaLine(film) {
  return [
    film.imdbRating && `IMDb ${film.imdbRating}`,
    film.rottenTomatoes && `RT ${film.rottenTomatoes}`,
    runtimeText(film.runtimeMin),
  ]
    .filter(Boolean)
    .join(' · ');
}

function titleHtml(film, style = '') {
  const t = escapeHtml(film.title);
  return film.trailerUrl ? `<a href="${escapeHtml(film.trailerUrl)}" style="color:#111;${style}">${t}</a>` : t;
}

// One row per cinema and day, times as booking links.
function scheduleRows(screenings, cinemas) {
  const rows = new Map();
  for (const s of screenings) {
    const key = `${s.cinemaKey}|${s.start.slice(0, 10)}`;
    if (!rows.has(key)) rows.set(key, { cinema: cinemaName(cinemas, s.cinemaKey), day: formatDay(s.start), times: [] });
    rows.get(key).times.push(s);
  }
  return [...rows.values()];
}

function timeLink(s) {
  const t = escapeHtml(formatTime(s.start));
  return s.bookingUrl ? `<a href="${escapeHtml(s.bookingUrl)}" style="color:#0b57d0">${t}</a>` : t;
}

function captionedBlock(group, cinemas) {
  const { film, screenings } = group;
  const meta = metaLine(film);
  const rows = scheduleRows(screenings, cinemas)
    .map(
      (r) =>
        `<tr><td style="padding:4px 6px;border-top:1px solid #eee"><b>${escapeHtml(r.cinema)}</b></td>` +
        `<td style="padding:4px 6px;border-top:1px solid #eee">${escapeHtml(r.day)}</td>` +
        `<td style="padding:4px 6px;border-top:1px solid #eee">${r.times.map(timeLink).join(' · ')}</td></tr>`,
    )
    .join('');
  return [
    '<div style="margin:0 0 26px">',
    film.image ? `<img src="${escapeHtml(film.image)}" alt="${escapeHtml(film.title)}" width="600" style="width:100%;max-width:600px;height:auto;border-radius:6px;display:block">` : '',
    `<p style="font-size:18px;font-weight:700;margin:10px 0 2px">${titleHtml(film)}</p>`,
    meta ? `<p style="color:#666;font-size:13px;margin:0 0 4px">${escapeHtml(meta)}</p>` : '',
    film.synopsis ? `<p style="color:#444;font-size:13px;margin:0 0 6px">${escapeHtml(truncate(film.synopsis, DIGEST_SYNOPSIS_CHARS))}</p>` : '',
    `<table style="border-collapse:collapse;width:100%;font-size:13px">${rows}</table>`,
    '</div>',
  ].join('');
}

function subtitledDays(screenings, cinemas) {
  const byCinema = new Map();
  for (const s of screenings) {
    const name = cinemaName(cinemas, s.cinemaKey);
    if (!byCinema.has(name)) byCinema.set(name, []);
    const day = formatDay(s.start);
    if (!byCinema.get(name).includes(day)) byCinema.get(name).push(day);
  }
  return [...byCinema].map(([name, days]) => `${name}: ${days.join(', ')}`).join(' · ');
}

function subtitledItem(group, cinemas) {
  const { film, screenings } = group;
  const meta = [film.imdbRating && `IMDb ${film.imdbRating}`, film.rottenTomatoes && `RT ${film.rottenTomatoes}`].filter(Boolean).join(' · ');
  return (
    `<li style="margin:4px 0"><b>${titleHtml(film)}</b>` +
    (meta ? ` <span style="color:#666">(${escapeHtml(meta)})</span>` : '') +
    `: ${escapeHtml(subtitledDays(screenings, cinemas))}</li>`
  );
}

function heading(text) {
  return `<h3 style="font-size:15px;text-transform:uppercase;letter-spacing:.05em;color:${ACCENT};border-bottom:2px solid ${ACCENT};padding-bottom:4px;margin:22px 0 12px">${escapeHtml(text)}</h3>`;
}

function problemLines(errors, notes, cinemas) {
  return [...errors.map((e) => `Couldn't read ${cinemaName(cinemas, e.cinemaKey)}: ${e.message}`), ...notes];
}

function buildDigest({ today, screenings, films, cinemas, errors, notes }) {
  const { from, to } = digestWindow(today);
  const inWindow = screenings.filter((s) => s.start.slice(0, 10) >= from && s.start.slice(0, 10) <= to && fitsFreeHours(s.start));
  const groups = groupByFilm(inWindow).map((g) => ({ ...g, film: mergeFilm(g.screenings[0], films[g.filmKey] || null) }));
  const split = (kind) =>
    groups
      .map((g) => ({ ...g, screenings: g.screenings.filter((s) => classify(s, g.film) === kind) }))
      .filter((g) => g.screenings.length);
  const captioned = split('captioned');
  const subtitled = split('subtitled');
  const problems = problemLines(errors, notes, cinemas);
  const subject = `🎬 ${DIGEST_NAME}: ${formatRange(from, to)}`;

  const html = [
    '<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.45;color:#222;max-width:600px">',
    `<h2 style="margin:0 0 4px">${escapeHtml(subject)}</h2>`,
    `<p style="color:#666;font-size:13px;margin:0 0 12px">${captioned.length} captioned film(s) that fit your hours</p>`,
    problems.length
      ? `<div style="background:#fff4e5;border:1px solid #f0c36d;border-radius:6px;padding:8px 12px;margin:0 0 12px;font-size:13px">${problems.map((p) => `<p style="margin:2px 0">⚠️ ${escapeHtml(p)}</p>`).join('')}</div>`
      : '',
    heading('Captioned (deaf/HoH)'),
    captioned.length ? captioned.map((g) => captionedBlock(g, cinemas)).join('') : '<p>No captioned screenings in the next two weeks.</p>',
    subtitled.length ? heading('Foreign-language, English subtitles') + `<ul style="padding-left:18px">${subtitled.map((g) => subtitledItem(g, cinemas)).join('')}</ul>` : '',
    `<p style="color:#888;font-size:12px;margin-top:20px;border-top:1px solid #eee;padding-top:10px">Also in your <a href="${CALENDAR_URL}">${DIGEST_NAME} calendar</a>. Sources: ${escapeHtml(cinemas.map((c) => c.name).join(', '))}.</p>`,
    '</div>',
  ].join('\n');

  const textBlock = (g) => {
    const meta = metaLine(g.film);
    const rows = scheduleRows(g.screenings, cinemas).map((r) => `  ${r.cinema}, ${r.day}: ${r.times.map((s) => formatTime(s.start)).join(', ')}`);
    return [g.film.title + (meta ? ` (${meta})` : ''), ...rows].join('\n');
  };
  const text = [
    subject,
    ...problems.map((p) => `! ${p}`),
    '',
    'CAPTIONED (DEAF/HOH)',
    captioned.length ? captioned.map(textBlock).join('\n\n') : 'No captioned screenings in the next two weeks.',
    ...(subtitled.length ? ['', 'FOREIGN-LANGUAGE, ENGLISH SUBTITLES', ...subtitled.map((g) => `${g.film.title}: ${subtitledDays(g.screenings, cinemas)}`)] : []),
  ].join('\n');

  return { subject, html, text };
}

function staleNotes({ statusRows, today, cinemas }) {
  return (statusRows || [])
    .filter((r) => r && r.cinema_key && r.last_captioned && daysBetween(r.last_captioned, today) >= STALE_DAYS)
    .filter((r) => cinemas.some((c) => c.key === r.cinema_key))
    .map((r) => `No captioned screenings from ${cinemaName(cinemas, r.cinema_key)} for 4 weeks; its reader may need checking.`);
}

function statusUpdates({ screenings, okCinemaKeys, statusRows, today }) {
  const known = new Set((statusRows || []).map((r) => r && r.cinema_key));
  return okCinemaKeys
    .filter((key) => !known.has(key) || screenings.some((s) => s.cinemaKey === key && s.kind !== 'subtitled'))
    .map((key) => ({ cinema_key: key, last_captioned: today }));
}

function buildAlert({ errors, capped, cinemas, executionUrl }) {
  const lines = [
    ...errors.map((e) => `${cinemaName(cinemas, e.cinemaKey)}: ${e.message}`),
    ...capped.map((key) => `Over ${MAX_REMOVALS_PER_CINEMA} screenings vanished from ${cinemaName(cinemas, key)}; nothing deleted.`),
  ];
  const subject = `Cinema sync: ${lines.length} problem(s)`;
  return {
    subject,
    text: [...lines, '', `Execution: ${executionUrl}`].join('\n'),
    html: [
      `<p>The cinema sync hit ${lines.length} problem(s). Other cinemas synced normally.</p>`,
      `<ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`,
      `<p><a href="${escapeHtml(executionUrl)}">Open the execution</a></p>`,
    ].join('\n'),
  };
}
