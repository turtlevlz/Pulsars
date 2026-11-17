# Astronaut Health Monitor: Metrics Specification and Implementation Guide

Audience: the Claude instance helping implement the NASA Space Apps project (frontend, backend, circuits integration).
Author: research lead. Status: v1, built from literature review (sources at the bottom).

## 1. Project context

We are building a dashboard that lets astronauts evaluate their own health during missions (spacecraft, station, rover, Moon/Mars base). NASA's five hazards of spaceflight (radiation, isolation and confinement, distance from Earth, gravity fields, hostile/closed environments) drive immune changes, cardiovascular adaptation, bone loss, sleep disruption, and behavioral problems.

Product parts:
- **Live dashboard**: heart rate, skin temperature, SpO2 from a wrist band (components already bought), plus trend charts and green/yellow/red status.
- **Log window**: manual entries (blood pressure, sleep log, symptoms, exercise).
- **Checkup window**: scheduled questionnaires and a short reaction test.
- **Medical AI assistant**: interprets current and personal historical data, gives guidance, and refers to medical professionals.
- **Gamification**: engagement with health-supporting routines (see section 9).

Design principle: **every metric must map hazard -> measurement -> decision -> action.** If a metric does not lead to an action the astronaut can take, cut it.

## 2. Critical framing (read before implementing)

1. **Two kinds of limits.** Cabin-environment limits come from NASA standards. The physiological tiers below (HR, SpO2, temperature, BP, sleep, questionnaires) are **proposed alert tiers**, built from clinical conventions and spaceflight studies. They are NOT NASA-published limits. Label them as such in the UI and documentation.
2. **Personal baseline first.** Astronaut physiology in flight differs from Earth norms (for example, HR and mean arterial pressure tend to run lower). Use each person's own baseline (the "set point") plus absolute safety limits. Think of it like process control: set point plus alarm limits.
3. **Alarm discipline.** Avoid alarm fatigue. Every alert needs a specific action. Red alerts require persistence and corroboration (section 6).
4. **This is not a diagnostic device.** Wearable sensors have known limits (SpO2 wearable error can reach several percentage points; wrist temperature is skin temperature, not core). Show limitations in the UI.

Every threshold row must carry an `evidence_level`: `NASA_STANDARD`, `CLINICAL_GUIDELINE`, `SPACEFLIGHT_DATA`, or `OUR_HEURISTIC`.

## 3. Input channels and data model

Three input channels:

| Channel | Metrics |
|---|---|
| **Measured (band, continuous)** | Heart rate (HR), skin temperature, SpO2, accelerometer (if the band has one; used to define "resting", detect motion artifacts, and infer sleep) |
| **Logs (manual, anytime or prompted)** | Blood pressure (with posture), sleep log, symptom picklist, exercise done (Y/N) |
| **Checkup (scheduled)** | WHO-5, PHQ-9, GAD-7, KSS, 3-minute reaction task (PVT-B style), quick ratings (stress, workload, fatigue), optional team items |

Suggested core entities:

```
Measurement { metric_id, value, unit, timestamp, source: "sensor"|"log"|"checkup",
              context: { posture?, activity_state?, environment_profile, symptoms? },
              quality: { motion_artifact?, sensor_fit?, stale_after_minutes } }
Baseline    { metric_id, rule, window, value, updated_at }
Tier        { metric_id, level: "green"|"yellow"|"red"|"gray", reason, evidence_level }
Alert       { metric_id|rule_id, level, message, recommended_action, escalate_to? }
CheckupResponse { instrument_id, item_scores[], total_score, timestamp }
```

Thresholds must be **data, not code**: one config file/table read by the frontend, the rules engine, and the assistant. Example row:

```json
{
  "metric_id": "hr_resting",
  "input": "sensor",
  "unit": "bpm",
  "baseline_rule": "rolling median of resting HR (7-day), resting = low accelerometer motion for >= 10 min",
  "tiers": {
    "green":  "within +/-10% of baseline AND 50-100 bpm",
    "yellow": ">10% off baseline sustained >= 30 min at rest, OR resting <50 or >100",
    "red":    "resting >120 or <40 sustained, OR any abnormal value with chest pain, fainting, or breathlessness (from symptom log)"
  },
  "persistence": "30 min",
  "evidence_level": "OUR_HEURISTIC",
  "sources": ["adult resting HR 60-100 bpm clinical convention", "lower in-flight HR in Shuttle/ISS studies"],
  "limitation": "Baseline must be recalibrated in flight; accuracy depends on band fit and motion",
  "action": { "yellow": "Rest, recheck, review hydration/sleep/stress", "red": "Notify crew medical officer / ground medical" }
}
```

Stale data rule: manual entries and old checkups decay to **gray** (unknown), never silently stay green. Show a "last updated" age on every tile.

## 4. Measured metrics (band)

### 4.1 Heart rate (HR)
- Purpose: cardiovascular adaptation, stress, illness, fatigue.
- Setpoint: personal resting HR (rolling median, accelerometer-gated).
- Tiers: see JSON above. Absolute reference: adult resting 60-100 bpm (clinical convention; cite a medical source in the document).
- Context: in-flight studies show HR and mean arterial pressure lower than pre-flight standing values; post-landing HR is higher during tasks. Do not apply Earth-only norms blindly.

### 4.2 Skin temperature (wrist)
- Purpose: infection/immune response, circadian phase, thermal stress.
- Reference: core temperature ~36.1-37.8 C; wrist skin temperature ~33-37 C (wider and individual). Fever cutoff ~38 C (core).
- Setpoint: the person's own day/night curve (circadian). Do NOT use a single absolute wrist threshold.
- Tiers: **green** within normal personal curve; **yellow** sustained rise of roughly 0.5-1 C above personal curve for the same time of day (tune with test data); **red** only on a **confirmed core/oral reading >= 38 C** (manual entry). The wearable alone triggers a prompt to confirm with a thermometer, never red by itself.
- Limitation: wrist-based core estimates have wide limits of agreement (about -0.7 to +0.9 C in one study).

### 4.3 SpO2
- Purpose: hypoxia screening, sleep-related desaturation, cabin atmosphere problems.
- Reference: normal >= 95%; below 90% (even transient) is clinically relevant.
- Tiers: **green** >= 95; **yellow** 90-94 (retest at rest, check sensor fit, check cabin O2/CO2 if available); **red** < 90 on multiple consecutive readings (for example >= 3), never a single reading.
- Limitation: individual wearable readings can differ from a medical oximeter by up to roughly 6% (90-100% range) and 8% (<90%), though detection of low saturation is reliable on average.
- Logic: if SpO2 is low and cabin inspired O2 partial pressure is also low, raise the **environmental** alarm first (see section 8).

### 4.4 Sleep (derived or logged)
- Purpose: neurobehavioral performance, mood, cardiovascular and immune health.
- Input: derive from HR plus accelerometer if possible; otherwise nightly sleep log (bedtime, wake time, quality).
- Reference: adults need 7-9 h. ISS crews are scheduled ~8.5 h but historically average ~6 h; chronic ~6 h degrades vigilance and mood.
- Tiers (7-day average, not single nights): **green** >= 7 h; **yellow** 6-7 h; **red** < 6 h (triggers countermeasures such as schedule and light review).
- Design note: red at < 6 h would flag the historical typical ISS astronaut. This is intentional (6 h is known to be degrading). Document it.

## 5. Log metrics

### 5.1 Blood pressure (manual cuff entry)
Required fields: SBP, DBP, HR at time, **posture** (supine/seated/standing), 5 minutes of rest confirmed, arm at heart level, symptoms, timestamp. Compute MAP = (2/3)DBP + (1/3)SBP.

Earth categories (2025 AHA/ACC): normal < 120/80; elevated 120-129 and < 80; stage 1 130-139 or 80-89; stage 2 >= 140 or >= 90. A commonly cited severe threshold is 180/120 (secondary source; confirm in the guideline). These describe chronic risk on Earth; in flight a lower baseline is expected, so use personal baseline too.

Hypotension: no universal cutoff. Commonly < 90/60, or SBP < 90, or MAP < 65. Fit people often run low without symptoms, so symptoms and change from baseline matter.

Tiers (evaluate red first):

| Level | High-end | Low-end |
|---|---|---|
| **Green** | < 130/80 and within ~10 mmHg systolic of personal baseline | >= 90/60, within ~20 mmHg of baseline, no symptoms |
| **Yellow** | 130-139/80-89 | < 90/60 without symptoms, or >= 20 mmHg systolic below baseline |
| **Red** | >= 140/90 on repeat, >= 180/120, or any reading with chest pain, neurological symptoms, or fainting | < 90/60 with symptoms (dizziness, near-fainting, confusion, blurred vision), MAP < 65 on repeat, or any fainting |

Evidence level: CLINICAL_GUIDELINE for categories, OUR_HEURISTIC for tiers.

### 5.2 Orthostatic check (enable ONLY in gravity environment profiles)
"Standing" is meaningless in microgravity. Enable this check in planetary-surface profiles and landing/return-to-gravity phases.
- Protocol: BP and HR after 5 min supine, then at 1 and 3 minutes standing.
- Orthostatic hypotension definition: sustained drop >= 20 mmHg systolic or >= 10 mmHg diastolic within 3 minutes.
- Tiers: **yellow** drop meeting the definition, no symptoms; **red** same drop with presyncope symptoms or any fainting.
- HR response interpretation: rise < 10 bpm with a BP drop suggests autonomic impairment (flag); rise > 30 bpm or HR > 100 with a BP drop suggests volume loss or POTS pattern; with symptoms, escalate.
- Context: about 20% of astronauts have presyncope after 10-14 day flights, and more than 60% could not finish a 10-minute head-up tilt on landing day after ~6 months. Applying this to Moon/Mars gravity transitions is our hypothesis (no partial-gravity data found); label it as such.
- Suggested actions: yellow = lie down, recheck in ~5 min, review hydration and intake. Red = lie down with legs raised, notify crew medical officer, escalate per protocol.

### 5.3 Symptom picklist (our design, not a validated instrument)
Items: headache, dizziness, nausea/motion sickness, vision change, GI symptoms, chest pain, fainting, shortness of breath; each with severity. Rules: headache -> display cabin CO2 if available; fainting/chest pain/sudden vision change -> red.

### 5.4 Exercise done (Y/N)
Used for gamification and adherence (ISS routine includes about 2 hours of exercise per day).

## 6. Alert logic

1. Evaluate red conditions first, then yellow, else green; stale data -> gray.
2. **Persistence**: require sustained or repeated values (HR >= 30 min at rest, SpO2 >= 3 consecutive readings, temperature rise sustained over a window).
3. **Corroboration**: use accelerometer (motion artifacts), sensor-fit quality, and related metrics before raising red.
4. Each alert carries: plain-language meaning, what to do now, when to escalate.
5. Rate-limit and group alerts to prevent fatigue. One recommended action per alert.

## 7. Checkup window (scheduled instruments)

Use the **official item text** of each instrument from its documentation (do not paraphrase items) and check each instrument's license/terms before embedding. All tiers below are proposals; these are **screening tools, not diagnoses**.

| Instrument | Evaluates | Scoring | Green | Yellow | Red |
|---|---|---|---|---|---|
| **WHO-5** | General well-being, past 2 weeks | 5 items, each 0-5, sum x4 = 0-100 (higher is better) | > 50 | <= 50 (common screening flag) | Not used alone; red comes from PHQ-9 |
| **PHQ-9** | Depressive symptoms, past 2 weeks | 9 items, each 0-3, total 0-27; cutpoints 5/10/15/20 | 0-4 | 5-14 | >= 15, OR any positive answer on item 9 (self-harm thoughts) |
| **GAD-7** | Anxiety symptoms, past 2 weeks | 7 items, each 0-3, total 0-21; cutpoints 5/10/15 (>= 10 is the usual point for further evaluation) | 0-4 | 5-14 | >= 15 |
| **KSS** | Sleepiness right now | Single item 1 (extremely alert) to 9 (very sleepy, fighting sleep) | <= 6 | 7 | >= 8 (advise deferring safety-critical tasks) |
| **PVT-B style reaction test (3 min)** | Objective vigilance/alertness; sensitive to sleep loss | Mean reaction time and lapses vs personal baseline | Near baseline | Clearly worse than baseline | Marked deterioration, or repeated yellow with short sleep |
| **Quick ratings** (stress, workload, fatigue) | Subjective daily load | Sliders 0-10 | Within personal norm | Above norm 2+ days in a row | Sustained high plus other yellow flags |
| **Team items** (optional, 2-3 items) | Cohesion and conflict | Short Likert items | Stable | Declining trend | Not tiered individually; show trends only, handle privacy carefully |

Notes:
- **PHQ-9 item 9 and red-tier mood must route to a human** (crew medical officer, flight surgeon, or psychologist per protocol). The AI assistant must not handle these alone. The design needs an explicit human-escalation path before item 9 is included.
- PVT has no universal cutoff; implement as a simple 3-minute reaction-time task and judge against each person's baseline. Objective tests matter because people can miss their own cognitive deficits.
- Mismatch highlighting: if KSS says alert but PVT is poor, tell the user performance may be worse than they feel.

Suggested cadence:

| Frequency | Items |
|---|---|
| Daily (~2 min) | Sleep log, KSS, quick ratings, symptom picklist, exercise done |
| Every ~4 days | 3-minute reaction test |
| Weekly | WHO-5, PHQ-9, GAD-7, optional team items |
| Optional monthly | Longer cognitive battery (future work) |

Rationale: PHQ-9/GAD-7/WHO-5 ask about the past two weeks, so asking daily adds noise. Precedents: ISS in-flight reaction testing scheduled about every fourth day; analog missions ran weekly batteries.

## 8. Cross-variable rules and environment profiles

Rules (OUR_HEURISTIC unless noted):
- **Low BP + rising HR + fever or low intake**: possible volume loss or infection; escalate faster than any single reading.
- **Short sleep + elevated resting HR + low WHO-5/mood**: crew-stress flag.
- **Low SpO2 + low cabin O2**: environmental alarm first.
- **Headache logged**: show cabin CO2 (NASA limits the one-hour average to 3 mmHg; headache risk modeled across roughly 2-5 mmHg; ISS crews reported symptoms from about 2.3 mmHg).
- **KSS >= 8 or reaction test deteriorating before a safety-critical task**: advise deferring the task.
- **KSS low but PVT poor**: highlight the mismatch.

Environment profiles (spacecraft/station, rover, Moon base, Mars base) change context and enabled checks:
- Orthostatic check only in gravity profiles (Moon ~1/6 g, Mars ~0.38 g, return to Earth).
- Optional ambient panel (stretch goal): cabin O2 partial pressure and CO2. Inspired O2 partial pressure PIO2 = (P_total - 47) x FO2 (mmHg; 47 mmHg is water vapor at body temperature). NASA's table: target 145-155 mmHg; mild-hypoxia lower limit 127 mmHg (acceptable about a week); indefinite hyperoxia upper limit 356 mmHg. Verify against the current NASA-STD-3001 revision before citing. Example: 8.2 psia habitat with 34% O2 gives about 128 mmHg, near the lower limit, so a fixed "21%" setpoint is wrong across environments.

## 9. AI assistant guardrails

- **Decision support, not diagnosis.** Combine rules, curated protocols, and the personal baseline. Do not act as a free-form chatbot.
- **Offline-capable.** Mars communication delay can reach roughly 20 minutes one way; the assistant must work onboard.
- **Always show its basis**: which data and which thresholds drove the advice, plus uncertainty.
- **Escalation rules are explicit**: red vitals, red mood, PHQ-9 item 9, fainting, chest pain, and sudden vision change always recommend human medical contact. Never delay escalation for self-help advice.
- No medication dosing recommendations.
- Plain-language explanations for each metric (do not assume astronauts know how to assess their health): how to measure it, what it means, why it matters.
- Label tiers as proposals and sensors as wellness-grade.

## 10. Gamification and UX

- Reward **routine adherence** (daily check-in, exercise, consistent sleep, scheduled measurements), not competition. Astronaut schedules are already packed; avoid points for their own sake.
- Dynamic charts of each metric over time with baseline bands; color-coded tiles (green/yellow/red/gray) readable at a glance.
- Prompts for scheduled measurements and checkups as part of the mission routine.
- Show data age and sensor quality on each tile.

## 11. Out of scope for MVP

Blood glucose, radiation dose (needs dosimeter feed), body mass, and cabin sensors beyond a stretch panel. Keep fields extensible (config-driven) so they can be added.

## 12. Open questions for the team

1. What does the band output (sampling rate, raw PPG, HRV)? Does it include an accelerometer?
2. Does the app need to work fully offline? (Assumed yes.)
3. Deadline, to decide how much of the weekly/monthly layer is realistic.
4. Demo plan: 3-5 synthetic scenarios (infection: temp up, HR up; sleep debt; hypoxia; orthostatic drop) to show measure -> interpret -> act.

## 13. Sources

NASA and spaceflight:
- NASA-STD-3001 Vol. 2, Section 6: https://www.nasa.gov/reference/6-0-natural-and-induced-environments-vol-2
- NASA OCHMO-TB-003 Habitable Atmosphere: https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-003-habitable-atmosphere.pdf
- NASA OCHMO-TB-004 Carbon Dioxide: https://nasa.gov/wp-content/uploads/2023/03/co2-technical-brief-ochmo.pdf
- NASA OCHMO-TB-041 Sleep Accommodations: https://www.nasa.gov/wp-content/uploads/2023/03/sleep-accomodations-technical-brief-ochmo.pdf
- EVA gas-related problems (PIO2 table): https://ntrs.nasa.gov/api/citations/20220019130/downloads/SKC%20EVA%20Gas%20Related%20Problems%20related%20to%20Spacesuits%20Dec%202022_Final.pdf
- CO2 on the ISS: An Operations Update: https://ntrs.nasa.gov/archive/nasa/casi.ntrs.nasa.gov/20150019624.pdf
- Post-spaceflight orthostatic hypotension: https://ntrs.nasa.gov/api/citations/20100033503/downloads/20100033503.pdf
- Orthostatic intolerance evidence report: https://ntrs.nasa.gov/api/citations/20150007319/downloads/20150007319.pdf
- Gradient compression garments after long-duration spaceflight: https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2020.00784/pdf
- Long-duration spaceflight HR and arterial pressure: https://peeref.com/works/15357458
- Astronaut sleep and neurobehavioral function (PMC8919197): https://pmc.ncbi.nlm.nih.gov/articles/PMC8919197
- NASA BHP Standard Measures overview: https://ntrs.nasa.gov/api/citations/20190000670/downloads/20190000670.pdf
- Cognition test battery: https://www.med.upenn.edu/uep/cognition.html
- Reaction Self Test / PVT: https://en.wikipedia.org/wiki/Psychomotor_vigilance_task
- Group Living Skills measure: https://ntrs.nasa.gov/citations/20240011745

Clinical:
- 2025 AHA/ACC BP categories (Harvard Health summary): https://www.health.harvard.edu/heart-health/reading-the-current-blood-pressure-guidelines
- Hypotension (StatPearls): https://www.statpearls.com/point-of-care/23295
- Orthostatic hypotension (StatPearls): https://www.ncbi.nlm.nih.gov/books/NBK448192/
- Orthostatic hypotension (MSD Manual): https://www.msdmanuals.com/professional/cardiovascular-disorders/symptoms-of-cardiovascular-disorders/orthostatic-hypotension
- Apple Watch SpO2 vs medical oximeter: https://pmc.ncbi.nlm.nih.gov/articles/PMC9554125
- Wrist-worn core temperature sensor study: https://link.springer.com/article/10.1186/s12938-023-01081-3
- Feasibility of continuous fever monitoring with wearables: https://pmc.ncbi.nlm.nih.gov/articles/PMC7736301
- WHO-5 scoring (PsyToolkit): https://us.psytoolkit.org/survey-library/who5.html
- PHQ-9 interpretation (UW): https://www.hivprep.uw.edu/page/mental-health-screening/phq-9
- GAD-7 scoring: https://concussionsontario.org/sites/default/files/2025-01/GAD7%20Appendix%208.2%20Jan%202025.pdf
- Karolinska Sleepiness Scale: https://en.wikipedia.org/wiki/Karolinska_Sleepiness_Scale
