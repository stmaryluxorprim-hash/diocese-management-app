# Logs Explorer queries — measuring Supabase "Logs Ingest"

"Logs Ingest" on the Supabase usage page is **platform telemetry** (one line per HTTP
request through the API gateway, Postgres server messages, Auth, Realtime, Storage).
It is *not* the app's `activity_log` table and it cannot be switched off — the only
lever is **fewer requests**. These queries show where the lines come from.

Supabase currently ships two Logs Explorer dialects. Use the block matching your
dashboard:

* **Classic** — *Logs & Analytics → Logs Explorer*. BigQuery SQL, one table per
  source (`edge_logs`, `postgres_logs`, …), `count(*)` allowed, nested fields via
  `cross join unnest(metadata)`.
* **New** — *Explorer → Run SQL → source "Logs"*. ClickHouse SQL, single `logs`
  table with a `source` column, `count(*)`/`select *` rejected (use `count()`),
  fields via `log_attributes['key']`.

Set the time range to **Last 24 hours** before running. Run one statement at a time.

---

## Classic dialect (BigQuery)

### A. Events per source (run each)

```sql
select count(*) as n from edge_logs
```
```sql
select count(*) as n from postgres_logs
```
```sql
select count(*) as n from auth_logs
```
```sql
select count(*) as n from realtime_logs
```
```sql
select count(*) as n from storage_logs
```

### B. Top API paths — what is draining ingest

```sql
select
  request.method,
  request.path,
  count(*) as n
from edge_logs
cross join unnest(metadata) as m
cross join unnest(m.request) as request
group by request.method, request.path
order by n desc
limit 40
```

`/rest/v1/<table>` = table reads/writes · `/rest/v1/rpc/<name>` = RPC ·
`/auth/v1/token` = token refresh · `/storage/v1/object/...` = photos ·
`/realtime/v1/websocket` = bus connects.

### C. Paths by status code (retry loops, 4xx storms)

```sql
select
  request.path,
  response.status_code,
  count(*) as n
from edge_logs
cross join unnest(metadata) as m
cross join unnest(m.request) as request
cross join unnest(m.response) as response
group by request.path, response.status_code
order by n desc
limit 40
```

### D. Requests per hour

```sql
select
  timestamp_trunc(timestamp, hour) as hour,
  count(*) as n
from edge_logs
group by hour
order by hour desc
```

### E. Requests by client (user agent)

```sql
select
  h.user_agent,
  count(*) as n
from edge_logs
cross join unnest(metadata) as m
cross join unnest(m.request) as request
cross join unnest(request.headers) as h
group by h.user_agent
order by n desc
limit 20
```

### F. Postgres lines by severity (should be almost only ERROR/FATAL after
`20261010120000_reduce_platform_log_ingest.sql` + `supabase_log_settings.sh`)

```sql
select
  p.error_severity,
  count(*) as n
from postgres_logs
cross join unnest(metadata) as m
cross join unnest(m.parsed) as p
group by p.error_severity
order by n desc
```

### G. Most frequent Postgres messages

```sql
select
  event_message,
  count(*) as n
from postgres_logs
group by event_message
order by n desc
limit 30
```

---

## New dialect (ClickHouse, single `logs` table)

### Events per source

```sql
select source, count() as n
from logs
group by source
order by n desc
limit 20
```

### Discover attribute keys for a source (run once)

```sql
select arrayJoin(mapKeys(log_attributes)) as k, count() as n
from logs
where source = 'edge_logs'
group by k
order by n desc
limit 100
```

### Top API paths

```sql
select
  log_attributes['request.method'] as method,
  log_attributes['request.path']   as path,
  count() as n
from logs
where source = 'edge_logs'
group by method, path
order by n desc
limit 40
```

### Paths by status

```sql
select
  log_attributes['request.path'] as path,
  log_attributes['response.status_code'] as status,
  count() as n
from logs
where source = 'edge_logs'
group by path, status
order by n desc
limit 40
```

### Requests per hour

```sql
select toStartOfHour(timestamp) as hour, count() as n
from logs
where source = 'edge_logs'
group by hour
order by hour desc
limit 48
```

### Postgres severities

```sql
select log_attributes['parsed.error_severity'] as sev, count() as n
from logs
where source = 'postgres_logs'
group by sev
order by n desc
limit 20
```

---

## Reading the results

* `edge_logs` will dominate; each line is roughly 1–2 KB whatever the request did.
  Free plan allowance (1 GB/month) ≈ 20–30k requests/day.
* A path with a very high count relative to the number of users/devices means a
  loop (polling, realtime echo, retry). Those are the ones to bundle into an RPC,
  patch in memory from the broadcast bus, or cache.
* `postgres_logs` should be a small fraction. If NOTICE/WARNING/LOG rows appear,
  the GUCs in `20261010120000_reduce_platform_log_ingest.sql` did not apply
  (re-run `supabase/scripts/supabase_log_settings.sh`).
* Turning logging "off" is not possible and would not change app behaviour:
  nothing in the app reads these logs. Reducing them only costs debugging detail.
