// ---- cinema-collect "Everyman request" node ----
const { everymanUrl } = $('Read').first().json;
return everymanUrl ? [{ json: { key: 'everyman', url: everymanUrl } }] : [];
