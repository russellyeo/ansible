# changedetection.io

Watches web pages and notifies other services when they change. UI at
`http://changedetection.home.arpa` (container port 5000, host port 5080).

## Ally Pally market watch

Triggers the n8n `ccfm-sync` workflow when the market schedule changes (see
`roles/n8n/README.md`). The watch lives in the datastore, not in Ansible, so
recreate it by hand (or through the API) if the datastore is lost:

| Setting | Value |
|---|---|
| URL | `https://www.weareccfm.com/our-markets/alexandra-palace/` |
| Title | `Ally Pally market schedule` |
| Recheck time | 6 hours |
| Fetch method | Plain HTTP requests (no browser needed; the page is server-rendered) |
| Filters & Triggers → Extract text | the two regexes below, one per line |
| Notification URL | `json://n8n:5678/webhook/ccfm-sync` |

```
/\d{1,2}(st|nd|rd|th)?\s+[a-z]+\.?\s+\d{4}/i
/[a-z ]+ location/i
```

Extracting only dates and location headings stops unrelated page edits from
triggering a sync. The notification goes over the Docker bridge network, so
it uses the container name `n8n`, not a `home.arpa` name.

### Creating it through the API

The API key is under Settings → API (or `settings.application.api_access_token`
in `changedetection.json` in the datastore).

```sh
curl -X POST -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  http://localhost:5080/api/v1/watch --data '{
    "url": "https://www.weareccfm.com/our-markets/alexandra-palace/",
    "title": "Ally Pally market schedule",
    "time_between_check": {"weeks": 0, "days": 0, "hours": 6, "minutes": 0, "seconds": 0},
    "fetch_backend": "html_requests",
    "extract_text": ["/\\d{1,2}(st|nd|rd|th)?\\s+[a-z]+\\.?\\s+\\d{4}/i", "/[a-z ]+ location/i"],
    "notification_urls": ["json://n8n:5678/webhook/ccfm-sync"]
  }'
```

The first check only records a baseline and sends no notification. To test
the path to n8n, post to the webhook from inside the container:

```sh
sudo docker exec changedetection python3 -c "import urllib.request as u; print(u.urlopen(u.Request('http://n8n:5678/webhook/ccfm-sync', data=b'{}')).read())"
```
