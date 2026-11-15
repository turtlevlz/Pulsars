# Pulsars — Backend Plan

Backend for a web dashboard that tracks patient vital signs. Stack: **Node + TypeScript + Express 5**, **PostgreSQL via Prisma**, **MQTT** for sensor data, and a **locally hosted LLM** for the symptom assistant.

Features in scope:

1. **Vital monitor**: take in heart rate, body temperature and blood oxygen readings, store them and serve them.
2. **Check-ups**: a doctor assigns a check-up (a set of questions) to a patient, and the patient answers it.
3. **Symptom log**: patients record symptoms that sensors can't measure.
4. **AI assistant**: asks follow-up questions based on a logged symptom.

Authentication and authorization are implemented (see [Auth](#auth-as-built)). The medic dashboard has its read-side endpoints and on-demand threshold alerts (see [Medic dashboard](#medic-dashboard-as-built)). Still deferred: live push to the dashboard, alert notifications, and device security (see [Later phases](#later-phases)).

---

## 1. Schema review

The plan is based on the ERD in `69fa4631-…jpeg`. It works as a base, but these gaps block the features and should be fixed before writing the Prisma schema:

| Table | Issue | Proposed fix |
|---|---|---|
| Heart Rate / Body Temp / Blood O | No timestamp, so readings can't be charted or averaged over time | Add `recorded_at timestamptz` (from the device), plus an index on `(user_id, recorded_at)` |
| Symptoms | The diagram draws the 1:n link to User but the table has no `user_id` column | Add `user_id fk` and `logged_at timestamptz` |
| Symptoms | `duration` and `frequency` have no type | `duration_minutes int`; `frequency` as an enum (`once`, `daily`, `several_daily`, `weekly`, `constant`) |
| Symptoms | `intensity 1-5` | `int` with a DB check constraint `BETWEEN 1 AND 5` |
| Questions | The diagram labels it m:n, but it has a single `checkup_id` FK, so it's really 1:n | Keep it 1:n (each question belongs to one check-up); `answer` nullable until answered |
| Checkups | No status or dates | Add `status` enum (`assigned`, `completed`), `assigned_at`, `due_at?`, `completed_at?` |
| Checkups | `user_id` and `medic_id` both point to User | Two named Prisma relations (`patient`, `medic`) |
| User | `password` | Store a hash (`password_hash`), never plaintext |
| User | `role` | Enum `patient`, `medic` (admin later if needed) |
| User | `avg_hr`, `avg_bt`, `avg_bo` are lifetime averages | Keep them, and add `hr_count`, `bt_count`, `bo_count int default 0` so the average can be updated per reading without scanning all history (see §3.1). Only the ingestion step writes them, never the client |
| *(missing)* | Nowhere to store AI follow-up conversations; Questions belongs to check-ups. A symptom can have several threads | Two new tables: `followup_threads` (`id`, `symptom_id fk`, `status` enum `open`/`done`, `created_at`, `closed_at?`) and `followup_messages` (`id`, `thread_id fk`, `role` `assistant`/`patient`, `content text`, `created_at`) |

Also add `created_at` to every table.

The three vitals tables stay **separate**, as drawn (decided). The vitals service maps each type (`hr`, `bt`, `bo`) to its table, so routes and the MQTT subscriber don't need to know which table is which.

---

## 2. Project structure

```
src/
  index.ts              # bootstraps HTTP server + MQTT subscriber
  app.ts                # express app, middleware, route mounting, error handler
  config.ts             # env parsing (DATABASE_URL, MQTT_URL, LLM_URL, PORT)
  db.ts                 # single PrismaClient instance
  modules/
    users/              # routes.ts, service.ts, schemas.ts
    vitals/
    checkups/
    symptoms/
    assistant/
  mqtt/
    subscriber.ts       # connects to broker, routes messages to vitals service
  llm/
    client.ts           # thin interface over the local model
  middleware/
    validate.ts         # zod request validation
    errors.ts           # HttpError + error handler
prisma/
  schema.prisma
  seed.ts
```

Each module splits into **routes** (HTTP only), **service** (business logic and Prisma calls) and **schemas** (zod validators). The MQTT subscriber and the HTTP routes call the same vitals service.

New dependencies: `prisma`, `@prisma/client`, `zod`, `mqtt`, `bcrypt` (or `argon2`), and `vitest` + `supertest` for tests.

---

## 3. Feature breakdown

### 3.1 Vital monitor (MQTT ingestion)

**Data flow:** sensor → MQTT broker (Mosquitto) → `mqtt/subscriber.ts` → `vitals.service.ingest()` → Postgres

- **Topic layout:** `pulsars/{userId}/vitals/{hr|bt|bo}`
- **Payload:** `{ "value": number, "recordedAt": ISO8601 }`
- **Subscriber:** subscribes to `pulsars/+/vitals/+`, parses the topic, validates the payload with zod and checks plausible ranges (e.g. HR 20–250, temp 30–45 °C, SpO₂ 50–100). Bad messages are logged and dropped.
- **QoS:** use QoS 1 (at-least-once delivery). To avoid duplicates, add a unique constraint on `(user_id, recorded_at)` and insert with `skipDuplicates`.
- **Averages (lifetime):** in the same Prisma transaction as the insert, update the user's average incrementally: `count = count + 1`, `avg = avg + (value - avg) / count`. Do the update in one SQL statement (`$executeRaw` with `UPDATE … SET`) so two readings arriving at once can't overwrite each other. Skipped duplicates must not change the count. If the cached values ever drift, a one-off script can rebuild them with `AVG()`/`COUNT()` over each table.
- **Device identity:** not secured yet. Later, give each device MQTT credentials and an ACL so it can only publish to its own topic.

**HTTP endpoints (read side):**

| Method | Path | Purpose |
|---|---|---|
| GET | `/users/:id/vitals?type=hr&from=&to=` | Time series for charts |
| GET | `/users/:id/vitals/latest` | Latest reading per type |
| GET | `/users/:id/vitals/summary` | Averages, min and max over a time range |
| POST | `/users/:id/vitals` | Manual or testing entry; uses the same `ingest()` as MQTT |

### 3.2 Check-ups

| Method | Path | Purpose |
|---|---|---|
| POST | `/checkups` | Medic creates a check-up for a patient, with its questions in the same request |
| GET | `/users/:id/checkups?status=` | Patient's check-ups, or check-ups assigned by a medic |
| GET | `/checkups/:id` | Check-up with its questions and answers |
| PUT | `/checkups/:id/answers` | Patient submits answers `[{questionId, answer}]`; once all are answered, status becomes `completed` |

- Create the check-up and its questions in a single Prisma transaction (nested `create`).
- Check roles in the service now (`medic_id` must belong to a medic, `user_id` to a patient), even before auth exists.

### 3.3 Symptom log

| Method | Path | Purpose |
|---|---|---|
| POST | `/users/:id/symptoms` | Log a symptom (name, intensity, notes, duration, frequency) |
| GET | `/users/:id/symptoms?from=&to=` | Symptom history |
| GET | `/symptoms/:id` | A symptom plus a list of its follow-up threads |
| PATCH | `/symptoms/:id` | Edit a symptom |
| DELETE | `/symptoms/:id` | Delete a symptom |

### 3.4 AI follow-up assistant

A symptom can have **multiple follow-up threads** (decided). For example, a patient may log a headache, answer a few questions, and start a new thread days later when it comes back or changes.

**Flow:**

1. When a patient logs a symptom, the backend opens the first thread automatically. It asks the LLM for an opening question and stores it in `followup_messages` as an `assistant` message.
2. The patient answers through `POST /threads/:id/messages`, which stores the reply as a `patient` message.
3. The backend sends the thread to the LLM, stores the next question and returns it.
4. The thread is marked `done` after N questions (say 3–5), or earlier if the model returns a "done" signal. Messages can't be added to a `done` thread. A thread that ends this way finishes with a **closing note**: a few very general, non-medical self-care tips written by the model from the patient's answers, wrapped in fixed text (not medical advice; contact your medic if it gets worse). Tips about medicine, doses or likely causes are filtered out in code.
   - **Emergencies** are recognised in code (patterns for chest pain, trouble breathing, stroke signs, fainting, severe bleeding, self-harm, ...) in the symptom text and in every answer. The patient is told to contact their medic right away, the thread closes and no tips are given.
5. Later, the patient can open a new thread on the same symptom with `POST /symptoms/:id/threads`. The new thread's prompt includes short summaries of the earlier threads, so the model can ask what has changed instead of repeating questions.

**Endpoints:**

| Method | Path | Purpose |
|---|---|---|
| POST | `/symptoms/:id/threads` | Open a new thread; returns it with the first question |
| GET | `/symptoms/:id/threads` | List a symptom's threads (status, dates) |
| GET | `/threads/:id` | A thread with all its messages |
| POST | `/threads/:id/messages` | `{ answer }` → `{ nextQuestion \| null, done }` |
| GET | `/users/:id/threads?from=&to=` | All of a patient's threads across symptoms, for the medic view |

**Medic access (decided: medics can see threads):** a medic sees threads read-only, using the last endpoint above and `GET /threads/:id`. Medics see a patient's threads next to that patient's check-ups and vitals. Only the patient can post answers; the route guards enforce that (see [Auth](#auth-as-built)).

**LLM integration (`src/llm/client.ts`):**

- One interface: `chat(messages): Promise<string>`, so the model can be swapped without touching the assistant module.
- Run the local model with **Ollama** (or llama.cpp server, LM Studio). All of them offer an OpenAI-compatible `/v1/chat/completions` endpoint, so `fetch` is enough and no SDK is needed. The URL and model name come from env.
- Ask the model for JSON output, `{ "question": string | null, "done": boolean }`, and validate it with zod. If parsing fails, fall back to a generic follow-up question.
- **Prompt context:**
  - the symptom fields
  - the patient's age, weight and height
  - the patient's recent vitals summary
  - the thread so far
- **System prompt:** the model only asks clarifying questions. It doesn't diagnose or give treatment advice, and it tells the patient to contact their medic or emergency services when a symptom looks severe.
- **Latency:** local models can be slow. Generating the first question can run asynchronously, so the POST that logs the symptom returns right away and the dashboard polls `GET …/followups`. Set a timeout on LLM calls.

---

## 4. Cross-cutting concerns

- **Validation:** a zod schema for every request body and query, applied through `validate()` middleware.
- **Errors:** one error handler that maps `HttpError` to its status and Prisma `P2025` to 404. Express 5 already forwards errors from async handlers.
- **Config:** read env once in `config.ts` and fail fast if a variable is missing.
- **Local environment:** a `docker-compose.yml` with `postgres`, `mosquitto` and optionally `ollama`.
- **Fix the build mismatch:** `package.json` sets `"type": "module"` but `tsconfig` compiles to `commonjs`. Change tsconfig to `"module": "nodenext"` and add a `start` script.
- **Housekeeping:** add `dist/` and `.env` to `.gitignore`.

---

## 5. Build order

1. **Foundation:** fix the tsconfig mismatch, add docker-compose, set up Prisma with the revised schema, run the first migration, add a seed (one medic, two patients) and the app/module skeleton with the error handler.
2. **Users:** basic CRUD so the other modules have users to reference. Hash passwords now even though login comes later.
3. **Symptom log:** plain CRUD and the simplest module, which establishes the module pattern.
4. **Check-ups:** nested create, answer submission and status changes.
5. **Vitals over HTTP:** `ingest()` plus the read endpoints, tested with the POST endpoint.
6. **MQTT subscriber:** connect it to `ingest()`. Test with `mosquitto_pub` or a small simulator script that publishes fake readings.
7. **AI assistant:** the LLM client, the follow-up thread and the prompt.
8. **Tests:** service-level tests with vitest against a test database, and route tests with supertest. The MQTT handler can be tested by calling the message handler directly.

---

## Later phases

- ~~**Auth**~~ — done, see [Auth](#auth-as-built).
- **Live dashboard:** when `ingest()` stores a reading, it emits an event. A WebSocket or SSE endpoint forwards new readings to dashboard clients.
- ~~**Alerts (display)**~~ — done on demand, see [Medic dashboard](#medic-dashboard-as-built).
- **Alert notifications:** push or e-mail a medic when a new episode starts (alerts are only listed today), and per-patient or per-medic limits.
- **Device security:** per-device MQTT credentials and topic ACLs.

---

## Decisions

| Question | Decision | Where it's applied |
|---|---|---|
| Is `avg_*` on User a lifetime average or a rolling window? | **Lifetime average**, updated per reading using stored counts | §1, §3.1 |
| Can a symptom have multiple follow-up threads? | **Yes**, through `followup_threads` + `followup_messages` | §1, §3.4 |
| Should medics see AI follow-up threads? | **Yes**, read-only | §3.4, Later phases |
| Merge the vitals tables or keep them separate? | **Keep them separate**, as drawn | §1 |

---

## Status and implementation notes (as built)

All eight build-order steps are implemented and covered by tests (`npm test`). Where the build differs from, or decides beyond, the text above:

- **Ports:** Postgres is published on host port **5433** (a native Postgres already used 5432). `docker-compose.yml` and `.env.example` reflect this.
- **IDs and login:** primary keys are `Int` autoincrement. Users log in with a unique, lower-cased `email` (added with auth).
- **Symptom logging response:** `POST /users/:id/symptoms` also returns `threadId` (the follow-up thread opened for it). The opening question is generated in the background; poll `GET /threads/:id`.
- **Check-ups:** `GET /users/:id/checkups` returns the patient's check-ups for a patient and the assigned ones for a medic, with `questionCount`/`answeredCount`. Answers can be saved partially and changed until the check-up completes; a completed check-up returns 409. A submission is all-or-nothing.
- **Vitals:** `GET /users/:id/vitals` requires `type`; a reading whose `(user, recordedAt)` already exists is a duplicate and is skipped even if the value differs. Plausible ranges: hr 20-250, bt 30-45, bo 50-100.
- **MQTT:** persistent session (`clean: false`, `MQTT_CLIENT_ID`) so QoS 1 messages queue while the backend is down. Malformed messages are logged and dropped; they are not retried.
- **Assistant:**
  - One open thread per symptom (a second `POST /symptoms/:id/threads` returns 409 with the open thread's id).
  - The thread closes after `ASSISTANT_MAX_QUESTIONS` (default 4) questions or when the model says it is done.
  - `{nextQuestion, done: true}` with a non-null question is a final message that expects no answer: the emergency notice or the closing note.
  - Emergency detection and the tip filter are deterministic (`safety.ts`) because a small local model proved unreliable at both: in a real-model test (MedGemma 1.5 4B) it kept asking intake questions about chest pressure with a numb left arm.
  - If the model is unreachable or returns unusable output (one retry), a generic fallback question is used, so thread progression never depends on the model being up.
  - Earlier threads reach the model as a condensed Q/A transcript (last two threads, each message clipped), not an LLM-generated summary.
  - Only the model ever sees a patient's free text, and its output is only used as question text or, after filtering, as tips in the closing note.
- **Real model:** the assistant has been run end to end against MedGemma 1.5 4B through Ollama (`LLM_URL=http://localhost:11434/v1`, `LLM_MODEL=medgemma1.5`); questions were model-written and fast once loaded (about 0.3-0.6 s warm, about 47 s to load the model cold). Tune the prompts in `src/modules/assistant/prompt.ts`.

### Auth (as built)

**Login.** `POST /auth/register` (public sign-up, always a *patient*; a `role` field is a 400), `POST /auth/login`, `GET /auth/me`, `POST /auth/password`. Register and login return `{ token, user }`. Everything else needs `Authorization: Bearer <token>`; only `/health` and the first two auth routes are public. `src/app.ts` mounts `authenticate` after them.

**Tokens.** HS256 JWTs signed with `JWT_SECRET` (at least 32 characters, required; `JWT_TTL_HOURS`, default 12). The algorithm is pinned and the issuer checked, so `alg: none` and other algorithms are refused. The token carries only `sub` (user id) and `tv` (the user's `token_version`). `authenticate` loads the user on every request, so the **role always comes from the database**, a deleted account stops working at once, and changing the password (`POST /auth/password`, which needs the current password) bumps `token_version`, which signs out every other device. There are no refresh tokens: when a token expires, the user signs in again. The client treats any 401 as "sign in again".

**Passwords and sign-in.** bcrypt, 8 to 72 *bytes* (longer is refused, not truncated). A wrong password and an unknown email give the same 401 and take about the same time. Five failed attempts per email and IP lock that pair out for 15 minutes (429 with `Retry-After`); the counter is in memory, so it is per process and resets on restart. Password change shares that limiter, and answers a wrong current password with 403 (not 401, so a client doesn't mistake it for an expired session).

**Who can do what** (`src/modules/auth/access.ts`, one place):

| | Patient | Medic |
|---|---|---|
| Vitals, check-ups, follow-up threads (read) | their own | patients they have assigned a check-up to |
| Symptom log (read) | their own | patients they have assigned a check-up to (read-only; added for the medic dashboard) |
| Fitness (`GET /users/:id/fitness/calendar\|day\|routines`) | their own | patients they have assigned a check-up to |
| Complete a routine (`PUT /users/:id/fitness/routines/:key/completion`) | their own | never |
| Alerts, vitals trend (`GET /users/:id/alerts`, `/vitals/trend`) | trend: their own; alerts: no | patients they have assigned a check-up to |
| Acknowledge an alert (`POST /users/:id/alerts/acknowledge`) | no | patients they have assigned a check-up to |
| `GET /patients/search`, `GET /patients/overview` | no | yes (search: any patient's id and name; overview: their own patients only) |
| Post vitals / symptoms, edit or delete symptoms, answer threads, open threads, answer check-ups | their own | never |
| Assign a check-up (`POST /checkups`) | no | yes, as themselves (`medicId` may be omitted; another medic's id is a 403) |
| Create an account with a role (`POST /users`) | no | yes |
| Profile read / edit / delete | their own | their own, plus read of patients they have a check-up with |
| `GET /users` | themselves | themselves and their patients |

A check-up is visible to its patient and to the medic who assigned it only. When a medic looks at a patient's check-ups they see just the ones they assigned, not other medics'.

`/users/:id/...` routes answer 403 whether or not that user exists. Single-record routes (`/symptoms/:id`, `/threads/:id`, `/checkups/:id`) answer 404 for a missing record and 403 for somebody else's.

**Known limits, on purpose:**
- Access for a medic is derived from a check-up row, and any medic can create one for any patient. There is no consent step, no patient-medic assignment and no admin role. Tightening it means a patient-medic link that a patient or admin approves.
- `POST /users` lets any medic create other medics; there is no admin.
- Public registration is unthrottled and reveals whether an email exists (409).
- Bearer tokens in the SPA live in `sessionStorage` (gone when the tab closes, readable by any script on the page, so keep the dashboard free of third-party scripts). Logging out only discards the token on the client; changing the password is the way to revoke one.
- The MQTT broker is still anonymous and the subscriber trusts the user id in the topic (device security phase). Keep the broker on loopback until then.
- Migrated databases: `20261115074500_auth` gave existing users generated emails (`user<id>@pulsars.local`), with `medic@`, `alice@` and `bob@pulsars.local` for the seed names, and left their passwords unchanged.

### Medic dashboard (as built)

The frontend's medic home page (`/`, role `medic`) is built on these read-side endpoints. All need a medic who has a check-up for the patient (`assertCanViewPatient`) unless noted.

| Method | Path | Purpose |
|---|---|---|
| GET | `/users/:id/vitals/trend?type=&from=&to=&points=` | Time-bucketed `{t, avg, min, max}` points for a chart. Default last 24 h, at most 31 days, `points` 2-240 (default 60). The bucket is `max(60 s, range / points)` rounded up to whole minutes and aligned with `date_bin`, so a chart doesn't shift between refreshes. Patients can read their own. |
| GET | `/users/:id/alerts?from=&to=&status=open\|all` | Alert episodes, newest first, with `acknowledgedAt`/`acknowledgedBy`. Default last 7 days, at most 31. Medic only. |
| POST | `/users/:id/alerts/acknowledge` | `{type, startedAt}`. 404 `No such alert` unless that episode exists. Idempotent; the first acknowledgement is kept. Medic only. |
| GET | `/patients/overview` | The medic's own patients: id, name, age, `lastReadingAt`, `openAlerts`. |
| GET | `/patients/search?q=` | Patients by name or id (min. 2 characters, 20 results, `%`/`_`/`\` stripped), id and name only, so a medic can find someone to assign a first check-up to. |

**Alerts are computed, not stored.** `modules/vitals/thresholds.ts` holds fixed default limits (heart rate above 100 bpm, body temperature above 37.8 °C, blood oxygen below 92 %). `modules/alerts/episodes.ts` averages readings into one-minute buckets (`modules/vitals/buckets.ts`), treats a bucket as a breach when its *average* is past the limit, and reports runs of at least **2 consecutive breaching minutes**; a minute with no readings ends a run. An episode is identified by `(patient, type, startedAt)`. The only stored state is `alert_acknowledgements` (migration `20261115103000_alert_acknowledgements`), unique on that triple, so changing the rule never leaves stale alert rows behind; an acknowledgement whose episode no longer computes is just ignored. "Open" means not acknowledged.

**Things to remember when reading an alert:** readings come from a wearable (skin temperature is not core temperature and SpO₂ is experimental on this hardware), the limits are not per-patient, and an alert is a prompt to look at the data, not a diagnosis. The dashboard's summary card is rule-based text built in the frontend from the same numbers (no model involved).

**Decided on purpose:** assigned medics may now **read** a patient's symptom log (`GET /users/:id/symptoms`, `GET /symptoms/:id`); writes stay patient-only. Any medic can still assign a check-up to any patient, which is also how they start following one (see Known limits above).

**Not built yet** (shown as placeholders or omitted in the UI): messaging between medic and patient, sending treatment instructions, per-patient thresholds, a mission/"since start" range, and a signal-delay indicator.
