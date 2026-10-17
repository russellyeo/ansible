// ---- ccfm-sync "Plan" node ----
const html = $('Fetch page').first().json.data;
const today = $now.setZone('Europe/London').toISODate();
const markets = parseSchedule(html, today); // throws -> error workflow emails
const events = $('List events').first().json.items || [];
const plan = planSync({ markets, events, today });
return [
  {
    json: {
      ops: calendarOps(plan),
      email: buildChangeEmail(plan),
      summary: {
        markets: markets.length,
        create: plan.create.length,
        update: plan.update.length,
        remove: plan.remove.length,
        capTripped: plan.capTripped,
      },
    },
  },
];
