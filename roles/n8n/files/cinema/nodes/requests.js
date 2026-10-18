// ---- cinema-collect "Requests" node ----
const today = londonToday();
return CINEMAS.map((cinema) => ({ json: { cinema, request: cinemaRequest(cinema, today) } }));
