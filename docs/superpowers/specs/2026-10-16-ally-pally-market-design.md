# Ally Pally Farmers' Market Automation: Design

Every Sunday the Alexandra Palace farmers' market runs at one of two places:
Alexandra Palace Park or Campsbourne School. The schedule is published at
https://www.weareccfm.com/our-markets/alexandra-palace/. This design keeps a
Google Calendar in sync with that page and emails a reminder every Saturday.

## Decisions (agreed 2026-10-16)

| # | Topic | Decision |
|---|-------|----------|
| Q1 | Calendar | Google Calendar |
| Q2 | Google sign-in callback | n8n gets HTTPS at `https://n8n.<tailnet>.ts.net` through a Tailscale sidecar container managed by Ansible |
| Q3 | Reminder channel | Gmail node (same Google sign-in) |
| Q4 | Sync trigger | changedetection.io webhook plus a weekly n8n schedule (Monday 07:00) as a backstop |
| Q5 | Target calendar | A new dedicated calendar ("Ally Pally Market") |
| Q6 | Event shape | Timed 10:00–15:00 Europe/London. Title `Farmers' Market – <location>`, address in Location, Maps link in the description |
| Q7 | Unlisted Sundays | No calendar event. The reminder says "nothing listed" |
| Q8 | Dates removed from the site | Delete the event and email about it. If more than 2 future dates vanish in one run, delete nothing and email instead |
| Q9 | Sync emails | Only surprising changes: a known date changed location, a known date was removed, or the safety cap tripped |
| Q10 | LLM fallback | Deferred. A parse failure fails the run, and the error workflow emails the error plus the page text |
| Q11 | Workflow source of truth | Repo. Ansible renders the workflow JSON and imports it with `n8n import:workflow` |
| Q12 | Reminder time | Saturday 18:00 Europe/London |

Smaller decisions made during the interview:
- changedetection.io checks the page every 6 hours, keeps only date and heading text, and posts to `http://n8n:5678/webhook/ccfm-sync` over the Docker bridge network.
- The webhook needs no authentication: it is only reachable on the LAN, and repeat syncs do no harm.
- `http://n8n.home.arpa` keeps working on the LAN. `https://n8n.<tailnet>.ts.net` becomes n8n's editor base URL, which Google sign-in uses for its callback.

## Page facts (observed 2026-10-16)

- The page is server-rendered HTML, so no JavaScript is needed to read it.
- There are two headings, `ALEXANDRA PALACE PARK LOCATION` and `CAMPSBOURNE SCHOOL LOCATION`. Each is followed by an address and dates typed by hand, such as `6TH SEPT 2026`.
- Past dates stay on the page. Some Sundays are not listed at all.

## Components

1. **`ccfm.js`**: a dependency-free library (parse, sync planning, email text). Node tests run it locally, and Ansible copies it verbatim into the n8n Code nodes.
2. **`ccfm-sync` workflow**: Schedule/Webhook → fetch page → list calendar events → plan → apply calendar operations, plus an email when the plan contains surprising changes.
3. **`ccfm-reminder` workflow**: Saturday 18:00 → list events → build the reminder → Gmail.
4. **`ccfm-error` workflow**: Error Trigger → Gmail. Both other workflows set it as their error workflow.
5. **Tailscale sidecar** (`n8n-tailscale` container): `tailscale serve` HTTPS → `http://n8n:5678`.
6. **`changedetection` role**: a changedetection.io container. The watch itself is configured once by hand, as documented in the role README.

## Identity of synced events

Each event the sync creates carries the private extended properties
`ccfmDate` (an ISO date) and `ccfmLocation` (`park` or `campsbourne`). The sync
ignores any event without `ccfmDate` and never touches events before today.
