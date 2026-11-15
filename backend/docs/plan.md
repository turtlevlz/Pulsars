# Pulsars — Backend Plan

Backend for a web dashboard that tracks patient vital signs. Stack: **Node + TypeScript + Express 5**, **PostgreSQL via Prisma**, **MQTT** for sensor data, and a **locally hosted LLM** for the symptom assistant.

Features in scope:

1. **Vital monitor**: take in heart rate, body temperature and blood oxygen readings, store them and serve them.
2. **Check-ups**: a doctor assigns a check-up (a set of questions) to a patient, and the patient answers it.
3. **Symptom log**: patients record symptoms that sensors can't measure.
4. **AI assistant**: asks follow-up questions based on a logged symptom.

Deferred for now: authentication and authorization, plus live push to the dashboard. The design leaves room for both (see [Later phases](#later-phases)).

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
4. The thread is marked `done` after N questions (say 3–5), or earlier if the model returns a "done" signal. Messages can't be added to a `done` thread.
5. Later, the patient can open a new thread on the same symptom with `POST /symptoms/:id/threads`. The new thread's prompt includes short summaries of the earlier threads, so the model can ask what has changed instead of repeating questions.

**Endpoints:**

| Method | Path | Purpose |
|---|---|---|
| POST | `/symptoms/:id/threads` | Open a new thread; returns it with the first question |
| GET | `/symptoms/:id/threads` | List a symptom's threads (status, dates) |
| GET | `/threads/:id` | A thread with all its messages |
| POST | `/threads/:id/messages` | `{ answer }` → `{ nextQuestion \| null, done }` |
| GET | `/users/:id/threads?from=&to=` | All of a patient's threads across symptoms, for the medic view |

**Medic access (decided: medics can see threads):** a medic sees threads read-only, using the last endpoint above and `GET /threads/:id`. Medics see a patient's threads next to that patient's check-ups and vitals. Only the patient can post answers. Until auth exists, that rule is just a role check in the service. Once auth is added, it's enforced by middleware (see Later phases).

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

- **Auth:** JWT or session login. Middleware attaches `req.user`, then role guards make sure patients only see their own data, and medics only see data (vitals, check-ups, follow-up threads) for patients they've assigned a check-up to. Only patients can post follow-up answers. Services already take a user ID, so this mostly means adding middleware.
- **Live dashboard:** when `ingest()` stores a reading, it emits an event. A WebSocket or SSE endpoint forwards new readings to dashboard clients.
- **Alerts:** threshold rules on incoming vitals (e.g. SpO₂ < 90) that notify the assigned medic.
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
- **IDs and login:** primary keys are `Int` autoincrement. The ERD has no login field on `users`; one (e.g. unique email) must be added together with auth.
- **Symptom logging response:** `POST /users/:id/symptoms` also returns `threadId` (the follow-up thread opened for it). The opening question is generated in the background; poll `GET /threads/:id`.
- **Check-ups:** `GET /users/:id/checkups` returns the patient's check-ups for a patient and the assigned ones for a medic, with `questionCount`/`answeredCount`. Answers can be saved partially and changed until the check-up completes; a completed check-up returns 409. A submission is all-or-nothing.
- **Vitals:** `GET /users/:id/vitals` requires `type`; a reading whose `(user, recordedAt)` already exists is a duplicate and is skipped even if the value differs. Plausible ranges: hr 20-250, bt 30-45, bo 50-100.
- **MQTT:** persistent session (`clean: false`, `MQTT_CLIENT_ID`) so QoS 1 messages queue while the backend is down. Malformed messages are logged and dropped; they are not retried.
- **Assistant:**
  - One open thread per symptom (a second `POST /symptoms/:id/threads` returns 409 with the open thread's id).
  - The thread closes after `ASSISTANT_MAX_QUESTIONS` (default 4) questions or when the model says it is done.
  - `{nextQuestion, done: true}` with a non-null question is a final message that expects no answer, used for the emergency notice.
  - If the model is unreachable or returns unusable output (one retry), a generic fallback question is used, so thread progression never depends on the model being up.
  - Earlier threads reach the model as a condensed Q/A transcript (last two threads, each message clipped), not an LLM-generated summary.
  - Only the model ever sees a patient's free text, and its output is only used as question text.
- **Not enforced until auth exists:** that only patients answer follow-ups or check-ups, that medics only see their own patients, and that a client can only act on its own user id. Today the API trusts the ids in the URL and body.
- **Not verified against a real model:** no local model runtime was available while building, so the assistant was exercised against a scripted model and a fake OpenAI-compatible HTTP server. Try a real model (e.g. Ollama) and tune the prompt in `src/modules/assistant/prompt.ts`.
