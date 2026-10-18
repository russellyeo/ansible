// ---- ccfm-reminder "Build reminder" node ----
// TO and PHOTOS ({ park, campsbourne }: base64 JPEGs) are prepended by the
// template. The photo travels inline (cid:) because Gmail cannot fetch
// images from the NAS.
const today = $now.setZone('Europe/London').toISODate();
const events = $('List events').first().json.items || [];
const reminder = buildReminder({ sunday: nextSunday(today), events });
const images = reminder.photo ? [{ cid: reminder.photo, contentType: 'image/jpeg', base64: PHOTOS[reminder.photo] }] : [];
return [{ json: { subject: reminder.subject, raw: buildMime({ to: TO, ...reminder, images }) } }];
