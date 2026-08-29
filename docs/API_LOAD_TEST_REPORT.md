# API & Load Testing Report

Test date: 2026-08-30 (Asia/Shanghai)

## 1. Environment

- Hardware: Intel Core i7-14650HX, 16 cores / 24 logical processors, 15.73 GB RAM.
- Backend: FastAPI + SQLAlchemy async + Uvicorn, single local process.
- Database: isolated SQLite test database; production database was not touched.
- Providers: Mock ASR, Mock LLM, Mock embeddings and Mock image provider. No DeepSeek or Ark paid calls were made.
- Workload: 50 isolated test identities, real HTTP, bearer authentication, ORM and persistence.
- Test duration: gradual/spike/short-soak HTTP workload 20.95 s; controlled provider workload 7.07 s; automated regression suite run separately.
- Post-load process snapshot: private bytes 101.77 MB, CPU time 15.12 s. The short soak is not long enough to prove absence of long-duration leaks.

## 2. API Inventory and Coverage

OpenAPI inventory: 44 business/health/media operations on 38 paths (48 operations including four UI/static routes).

| API | Method | Auth | Input | Output | DB | External service |
| --- | --- | --- | --- | --- | --- | --- |
| `/health`, `/health/ready` | GET | No | none | health JSON | readiness checks DB | Redis readiness |
| `/auth/register` | POST | No | email/password/nickname | token + user | User, RefreshToken | none |
| `/auth/login` | POST | No | email/password | token + user | User, RefreshToken, RateLimitCounter | none |
| `/auth/logout` | POST | Yes | token/cookie | status | User, RefreshToken | none |
| `/auth/me` | GET | Yes | token/cookie | user | User | none |
| `/auth/device` | POST | Device proof | device id/version/secret | token + user | User, RefreshToken | none |
| `/auth/refresh` | POST | Refresh token | token/cookie | rotated token | User, RefreshToken | none |
| `/jobs/comic` | POST | Yes | text/character/style/reference | queued job | Job, RateLimitCounter | async LLM/image |
| `/jobs/{id}` | GET | Yes, owner | job id | job state/result | Job | none |
| `/jobs/{id}/cancel` | POST | Yes, owner | job id | job state | Job, DailyDiary | queue state |
| `/jobs/{id}/events` | GET | Yes, owner | job id | SSE state | Job | none |
| `/entries/text` | POST | Yes | text/date/timezone/idempotency | entry | DiaryEntry | LLM analyzer |
| `/entries/voice` | POST | Yes | audio/date/timezone/idempotency | transcript entry | DiaryEntry | ASR + analyzer |
| `/entries` | GET | Yes | date/cursor/limit | paged entries | DiaryEntry | none |
| `/entries/{id}` | GET/PATCH/DELETE | Yes, owner | id/update | entry or 204 | DiaryEntry, Artifact, Job | storage on delete |
| `/entries/{id}/comic-jobs` | POST | Yes, owner | character/style/reference/idempotency | queued job | Entry, Job, RateLimitCounter | async LLM/image |
| `/characters` | GET/POST | Yes | character config | characters | Character | none |
| `/characters/{id}` | PATCH | Yes, owner | character config | character | Character | none |
| `/characters/{id}/references` | POST | Yes, owner | image/kind | reference | CharacterReference | private storage |
| `/characters/{id}/references/{ref}` | DELETE | Yes, owner | ids | 204 | CharacterReference | private storage |
| `/artifacts/{id}` | GET | Yes, owner | id | artifact/panels | Artifact, Panel | private storage URLs |
| `/artifacts/{id}/panels/{n}/retry` | POST | Yes, owner | ids | queued job | Artifact, Panel, Job, RateLimitCounter | async image |
| `/daily-diaries/{date}` | GET/PATCH | Yes | date/timezone/update | daily diary | DailyDiary, Entry links, Artifact | none |
| `/daily-diaries/{date}/summary-jobs` | POST | Yes | date/timezone | daily summary | DailyDiary, Entry links | LLM analyzer |
| `/daily-diaries/{date}/storybook-jobs` | POST | Yes | date/timezone | queued job | DailyDiary, Job, RateLimitCounter | async LLM/image |
| `/me/preferences` | GET/PATCH | Yes | memory preference | preferences | User, MemoryItem, PetSession | none |
| `/me/export` | POST | Yes | none | user data export | user-scoped tables | none |
| `/me/data` | DELETE | Yes | none | 204 | user-scoped tables | private storage |
| `/diaries` | GET | Yes | none | compatibility history | Job, Artifact, Panel | none |
| `/diaries/{job}` | GET/DELETE | Yes, owner | job id | diary or 204 | Job, Artifact, Panel | private storage |
| `/diaries/{job}/panels/{n}/regenerate` | POST | Yes, owner | prompt/style | diary | Job, Artifact, Panel, RateLimitCounter | image provider |
| `/diaries/text-generate` | POST | Yes | text/style/idempotency | diary | Entry, Job, Artifact, Panel | LLM/image; deprecated |
| `/diaries/voice-generate` | POST | Yes | audio/style/idempotency | diary | Entry, Job, Artifact, Panel | ASR/LLM/image; deprecated |
| `/pet/chat` | POST | Yes | message/history/stream | reply or SSE | User, Diary, Memory, RateLimitCounter | LLM |
| `/pet/status` | GET | Yes | pet name | status | User auth | none |
| `/pet/memories` | GET | Yes | optional query | memories | MemoryItem | none |
| `/media/{filename}` | GET | Yes, owner | filename | private file | Artifact, Panel, CharacterReference | private storage |

- PASS: 44 operations have automated behavior or end-to-end coverage after this run.
- FAIL: 0 after fixes.
- NOT TESTED: 0 at local/mock integration level.
- Frontend-to-backend mismatch: no frontend call points to a nonexistent backend route.
- Deprecated backend APIs: `POST /diaries/text-generate` and `POST /diaries/voice-generate`; compatibility read/delete/regenerate routes are still consumed by Web v2.

## 3. Load Test

Mixed workload: Entry List 45%, compatibility Diary List 25%, Auth Me 15%, Preferences 10%, Entry Create 5%.

| Concurrent | Requests | RPS | P50 | P95 | P99 | Error rate |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 100 | 268.43 | 3.09 ms | 13.82 ms | 16.58 ms | 0% |
| 10 | 100 | 307.62 | 29.79 ms | 58.27 ms | 66.68 ms | 0% |
| 25 | 125 | 295.53 | 67.68 ms | 143.51 ms | 178.05 ms | 0% |
| 50 | 250 | 337.24 | 120.02 ms | 284.78 ms | 341.70 ms | 0% |
| 100 | 500 | 185.91 | 351.22 ms | 1386.92 ms | 2092.29 ms | 0% |
| 200 | 1000 | 240.49 | 599.95 ms | 2227.62 ms | 2906.38 ms | 0% |

Spike 100: P95 3219.26 ms, 0% HTTP errors. Recovery at 10: P95 170.24 ms, 0% errors. Short soak at 25: 1000 requests, P95 420.96 ms, one `RemoteProtocolError` (0.1%).

## 4. AI Performance

Mock Chat:

| Concurrent | Requests | P50 | P95 | P99 | Error rate |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 5 | 13.91 ms | 33.51 ms | 33.51 ms | 0% |
| 3 | 9 | 14.35 ms | 122.18 ms | 122.18 ms | 0% |
| 5 | 15 | 32.50 ms | 325.66 ms | 325.66 ms | 0% |
| 10 | 30 | 31.14 ms | 752.97 ms | 860.48 ms | 0% |
| 20 | 60 | 128.61 ms | 1099.69 ms | 1316.33 ms | 0% |

Provider 429/5xx and connection reset use finite exponential retry (maximum three attempts). Provider timeout/failure is persisted as a failed job. Real DeepSeek limits and latency remain unmeasured by design.

## 5. Illustration Performance

Mock end-to-end job completion: concurrency 1/2/5/10 had 0% errors; P95 was 163.89/153.16/637.44/1088.90 ms. Real Ark concurrency and billing limits remain unmeasured.

## 6. Database

- Successful load writes: 233 DiaryEntry rows total, exactly matching 50 seed writes plus 183 HTTP 201 responses.
- Duplicate/missing/orphan records: 0 in the isolated load DB.
- Query plan for user diary list: `SEARCH diary_entries USING INDEX ix_diary_entries_user_entry_date (user_id=?)`.
- Relevant constraints/indexes exist for `(user_id, local_id)`, `(user_id, entry_date)`, `(user_id, idempotency_key)`, user/date daily diary, job/artifact and user/memory dates.
- SQLite has no production-equivalent DB connection pool metric. PostgreSQL connection saturation was not tested.

## 7. Concurrency and Idempotency

- Five simultaneous requests with the same comic idempotency key now return one job id and create one Job row.
- Fixed rollback race that previously raised `MissingGreenlet` after the uniqueness conflict.
- Web v2 now uses an in-flight generation lock and sends one stable idempotency key per generation attempt.
- Comic/chat rate limits return 429. Compatibility panel regeneration now also consumes the comic rate limit.

## 8. Data Isolation and Integrity

- User B received 404 for User A Job get/cancel/events, Entry get/update/delete, Artifact get/retry, Diary get/delete/regenerate, and private media.
- User B AI retrieval did not receive User A's marker `星星柠檬4729`; User A retained access.
- Memory opt-out now prevents recent diary and ranked memory data from entering the LLM prompt.
- Diary text remains saved when illustration generation fails; generation failure is independently retryable.

## 9. Bugs and Fixes

| Severity | Problem | Root cause | Fix | Retest |
| --- | --- | --- | --- | --- |
| P1 | Memory opt-out still allowed diary context in chat | chat route queried recent diaries regardless of preference | gate recent diary and memory retrieval on `memory_opt_in` | PASS |
| P1 | Concurrent identical generation could throw after DB uniqueness conflict | ORM User expired after rollback, then async attribute access occurred outside greenlet | cache scalar user id before transaction/rollback | PASS, 5 concurrent → 1 Job |
| P1 | Web double click could enqueue distinct paid jobs | comic call lacked in-flight guard and idempotency header | synchronous ref lock + stable request id header | typecheck PASS; API concurrency PASS |
| P2 | Empty/oversized chat could reach provider | no message/history bounds | 1–4000 chars, blank rejection, history max 20 | PASS |
| P2 | Connection reset was not retried | retry handled only HTTP responses | bounded retry for `httpx.TransportError` | PASS |
| P2 | Compatibility panel redraw bypassed comic rate counter | route called image service directly | consume comic rate limit before redraw | PASS |

## 10. Maximum Stable Load

Measured on this local single-process SQLite environment:

- Stable concurrent mixed HTTP clients: **50** (P95 284.78 ms, 0% errors).
- Sustainable mixed throughput at that point: **337.24 RPS** for the measured short stage.
- Controlled Mock AI concurrent requests: **20** (P95 1099.69 ms, 0% errors).
- Controlled Mock illustration jobs: **10** (P95 1088.90 ms, 0% errors).

These are not production capacity claims. At 100+ HTTP concurrency, tail latency exceeded one second; the short soak also had one connection-level error.

## 11. Remaining Risks

- No destructive load was run against production, PostgreSQL, Redis, DeepSeek, Ark or real ASR.
- The soak period was short and cannot exclude long-term memory/file descriptor/connection leaks.
- Memory retrieval intentionally bounds each candidate source to its newest 50 records. This prevents token explosion but can miss an older relevant diary for a user with 1000 entries; a production FTS/vector index is still needed.
- Legacy synchronous panel regeneration remains a compatibility path; it is rate-limited but should ultimately migrate to the queued artifact retry API.
- Production multi-worker limits, Redis queue backpressure, PostgreSQL pool sizing and provider account quotas need staging validation before broad launch.

## 12. Final Result

### READY FOR CONTROLLED USER TESTING

The local/mock integration environment now passes the full user flow and cross-user isolation gates, and no open P0/P1 issue remains in the exercised scope. Rollout should remain controlled until staging validates PostgreSQL/Redis and real-provider latency/quotas under low capped concurrency.
