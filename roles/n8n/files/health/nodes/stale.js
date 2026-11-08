// ---- health-stale "Check" node ----
// Input: last-payload.json, parsed by "Extract".
const days = daysSince($input.first().json.data.received, $now.toISO());
return [{ json: { stale: days >= 3, days } }];
