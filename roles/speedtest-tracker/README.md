# Speedtest Tracker

## Schema
- `id`: Unique identification number for each speed test entry.
- `ping`: The latency value in milliseconds (ms) for the speed test.
- `download`: The download speed measured in the speed test in bits per second (bps).
- `upload`: The upload speed measured in the speed test in bits per second (bps).
- `server_id`: Identifier for the server used for the speed test.
- `server_host`: Hostname of the server used for the speed test.
- `server_name`: Name of the server used for the speed test.
- `url`: The URL for the speed test result.
- `scheduled`: A boolean field to indicate whether the speed test was scheduled or not.
- `data`: A JSON object containing detailed information from the speed test result, includes timestamp, jitter, "isp" (Internet Service Provider), latency, bandwidth, bytes, elapsed time, internal and external IP addresses, packetLoss, Interface details (name, macAddr), server details (ip, location, country), result details (id, url, persisted).
- `created_at`: The time stamp when the speed test result was created.
- `successful`: A boolean field to indicate whether the speed test was completed successfully or not.
- `comments`: Optional comments on the speed test result.

## Connect

Connect to the database
```sh
sudo docker exec -it postgres psql -U speedy -d speedtest_tracker
```

## Queries

Average download speed over the last 24 hours
```sql
SELECT AVG(download) / 1000000 AS average_download_last_24hr_Mbps
FROM results
WHERE created_at >= NOW() - INTERVAL '24 hours';
```

Count the number of entries where there was no connection over the last 24 hours.
```sql
SELECT COUNT(*) AS total_count_no_connection_last_24hr
FROM results
WHERE download IS NULL AND created_at >= NOW() - INTERVAL '24 hours';
```

Calculate the percentage of entries that had no connection over the last 24 hours.
```sql
SELECT 
    ROUND((COUNT(*) FILTER (WHERE download IS NULL) * 100.0) / COUNT(*), 2) AS percentage_time_down
FROM results
WHERE created_at >= NOW() - INTERVAL '24 hours';
```
