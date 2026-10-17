// ---- ccfm-reminder "Build reminder" node ----
const today = $now.setZone('Europe/London').toISODate();
const events = $('List events').first().json.items || [];
return [{ json: buildReminder({ sunday: nextSunday(today), events }) }];
