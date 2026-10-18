// The Friday digest and the sync's alert email.

const DIGEST_NAME = 'Subtitled Cinema Screenings';
const STALE_DAYS = 28;
const ACCENT = '#8a2be2';
const RT_FRESH_ICON = 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Rotten_Tomatoes.svg/60px-Rotten_Tomatoes.svg.png';
const RT_ROTTEN_ICON = 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/Rotten_Tomatoes_rotten.svg/60px-Rotten_Tomatoes_rotten.svg.png';
const RT_FRESH_FROM = 60;

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

// Ratings, runtime and the trailer link under a film's title. The IMDb badge
// is HTML so it shows even with images off; the tomato is Wikimedia's PNG.
function metaHtml(film) {
  const num = (v) => `<b style="color:#222">${escapeHtml(v)}</b>`;
  const imdb = '<span style="background:#f5c518;color:#000;font-weight:800;font-size:11px;border-radius:3px;padding:0 4px">IMDb</span>';
  const fresh = parseInt(film.rottenTomatoes, 10) >= RT_FRESH_FROM;
  const tomato = `<img src="${fresh ? RT_FRESH_ICON : RT_ROTTEN_ICON}" alt="${fresh ? 'Fresh' : 'Rotten'}" width="14" height="14" style="vertical-align:-2px">`;
  const parts = [
    film.imdbRating && `${imdb} ${num(film.imdbRating)}`,
    film.rottenTomatoes && `${tomato} ${num(film.rottenTomatoes)}`,
    runtimeText(film.runtimeMin) && `⏱ ${runtimeText(film.runtimeMin)}`,
    // YouTube-style red play badge; U+FE0E keeps iOS from drawing ▶ as an emoji.
    film.trailerUrl &&
      `<a href="${escapeHtml(film.trailerUrl)}" style="color:#222;font-weight:600;text-decoration:none">` +
        '<span style="display:inline-block;background:#ff0000;color:#fff;border-radius:5px;font-size:9px;line-height:13px;padding:0 5px;vertical-align:1px">&#9654;&#xFE0E;</span> Watch trailer</a>',
  ].filter(Boolean);
  return parts.length ? `<p style="color:#666;font-size:13px;margin:0 0 6px">${parts.join('&nbsp;&nbsp;&nbsp;')}</p>` : '';
}

function titleHtml(film) {
  const t = escapeHtml(film.title);
  return film.imdbId ? `<a href="https://www.imdb.com/title/${escapeHtml(film.imdbId)}/" style="color:#111">${t}</a>` : t;
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
  const rows = scheduleRows(screenings, cinemas)
    .map(
      (r) =>
        `<tr><td style="padding:4px 6px;border-top:1px solid #eee"><b>${escapeHtml(r.cinema)}</b></td>` +
        `<td style="padding:4px 6px;border-top:1px solid #eee">${escapeHtml(r.day)}</td>` +
        `<td style="padding:4px 6px;border-top:1px solid #eee">${r.times.map(timeLink).join(' · ')}</td></tr>`,
    )
    .join('');
  return [
    '<div style="margin:0 0 18px;border:1px solid #e6e6ec;border-radius:10px;padding:12px;background:#fafafc">',
    film.image ? `<img src="${escapeHtml(film.image)}" alt="${escapeHtml(film.title)}" width="600" style="width:100%;max-width:600px;height:auto;border-radius:6px;display:block">` : '',
    `<p style="font-size:18px;font-weight:700;margin:10px 0 2px">${titleHtml(film)}</p>`,
    metaHtml(film),
    film.synopsis ? `<p style="color:#444;font-size:13px;margin:0 0 6px">${escapeHtml(film.synopsis)}</p>` : '',
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

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function hoursNote(hours) {
  return `Weekday screenings are only included from ${hours.weekdayFrom}.`;
}

function problemLines(errors, notes, cinemas) {
  return [...errors.map((e) => `Couldn't read ${cinemaName(cinemas, e.cinemaKey)}: ${e.message}`), ...notes];
}

function buildDigest({ today, screenings, films, cinemas, errors, notes, hours = FREE_HOURS_DEFAULT }) {
  const { from, to } = digestWindow(today);
  const inWindow = screenings.filter((s) => s.start.slice(0, 10) >= from && s.start.slice(0, 10) <= to && fitsFreeHours(s.start, hours));
  const groups = groupByFilm(inWindow).map((g) => ({ ...g, film: mergeFilm(g.screenings[0], films[g.filmKey] || null) }));
  const split = (kind) =>
    groups
      .map((g) => ({ ...g, screenings: g.screenings.filter((s) => classify(s, g.film) === kind) }))
      .filter((g) => g.screenings.length);
  const captioned = split('captioned');
  const subtitled = split('subtitled');
  const problems = problemLines(errors, notes, cinemas);
  const subject = `🎬 ${DIGEST_NAME}: ${formatRange(from, to)}`;

  const cinemaCount = new Set(captioned.flatMap((g) => g.screenings.map((x) => x.cinemaKey))).size;
  const summary = `${formatRange(from, to)}, ${plural(captioned.length, 'subtitled movie')} showing at ${plural(cinemaCount, 'cinema')}`;

  const html = [
    '<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.45;color:#222;max-width:600px">',
    `<p style="color:#666;font-size:13px;margin:0 0 12px">${escapeHtml(summary)}</p>`,
    heading('Subtitled'),
    captioned.length ? captioned.map((g) => captionedBlock(g, cinemas)).join('') : '<p>No subtitled screenings in the next two weeks.</p>',
    subtitled.length ? heading('Foreign-language, English subtitles') + `<ul style="padding-left:18px">${subtitled.map((g) => subtitledItem(g, cinemas)).join('')}</ul>` : '',
    problems.length
      ? `<div style="background:#fff4e5;border:1px solid #f0c36d;border-radius:6px;padding:8px 12px;margin:20px 0 0;font-size:13px">${problems.map((p) => `<p style="margin:2px 0">⚠️ ${escapeHtml(p)}</p>`).join('')}</div>`
      : '',
    `<p style="color:#888;font-size:12px;margin-top:20px;border-top:1px solid #eee;padding-top:10px">${escapeHtml(hoursNote(hours))} Sources: ${escapeHtml(cinemas.map((c) => c.name).join(', '))}.</p>`,
    '</div>',
  ].join('\n');

  const textBlock = (g) => {
    const meta = metaLine(g.film);
    const rows = scheduleRows(g.screenings, cinemas).map((r) => `  ${r.cinema}, ${r.day}: ${r.times.map((s) => formatTime(s.start)).join(', ')}`);
    return [g.film.title + (meta ? ` (${meta})` : ''), ...rows].join('\n');
  };
  const text = [
    summary,
    '',
    'SUBTITLED',
    captioned.length ? captioned.map(textBlock).join('\n\n') : 'No subtitled screenings in the next two weeks.',
    ...(subtitled.length ? ['', 'FOREIGN-LANGUAGE, ENGLISH SUBTITLES', ...subtitled.map((g) => `${g.film.title}: ${subtitledDays(g.screenings, cinemas)}`)] : []),
    ...(problems.length ? ['', ...problems.map((p) => `! ${p}`)] : []),
    '',
    hoursNote(hours),
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

function buildAlert({ errors, capped, held = [], cinemas, executionUrl }) {
  const lines = [
    ...errors.map((e) => `${cinemaName(cinemas, e.cinemaKey)}: ${e.message}`),
    ...capped.map((key) => {
      const events = held.filter((h) => h.cinemaKey === key);
      const list = events.map((h) => `${h.summary} (${formatDay(h.start)} ${formatTime(h.start)})`).join('; ');
      return (
        `${cinemaName(cinemas, key)}: ${plural(events.length, 'screening')} vanished at once (more than ${MAX_REMOVALS_PER_CINEMA}, or its listing came back empty); ` +
        `nothing deleted${list ? `: ${list}` : ''}. Check its reader, or delete these by hand if they really were cancelled.`
      );
    }),
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
