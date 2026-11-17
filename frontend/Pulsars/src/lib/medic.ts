import type { Alert, Latest, RosterPatient, Threshold, Trend, TrendPoint, VitalSummary } from "../api/medic";
import type { CheckupSummary } from "../api/checkups";
import type { Symptom } from "../api/symptoms";
import type { VitalType } from "../api/vitals";
import { VITAL_DEFINITIONS } from "./vitals";

// ------------------------------------------------------------------ ranges

export type RangeId = "24h" | "7d" | "30d";

const HOUR = 3600_000;

export const RANGES: { id: RangeId; label: string; ms: number; phrase: string; ago: string }[] = [
  { id: "24h", label: "24 h", ms: 24 * HOUR, phrase: "last 24 hours", ago: "24 h ago" },
  { id: "7d", label: "7 days", ms: 7 * 24 * HOUR, phrase: "last 7 days", ago: "7 d ago" },
  { id: "30d", label: "30 days", ms: 30 * 24 * HOUR, phrase: "last 30 days", ago: "30 d ago" },
];

export const rangeById = (id: RangeId) => RANGES.find((r) => r.id === id)!;

// ------------------------------------------------------------------ people

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
  return letters.toUpperCase();
}

export type PatientStatus = "alert" | "normal" | "nodata";

/** Readings older than this make a patient "No data" in the list (the cuff is probably off). */
const NO_DATA_AFTER_MS = 60 * 60_000;

/** `level` is set for an open alert: the worst tier among the patient's open alerts. */
export function rosterStatus(
  p: RosterPatient,
  now: number,
): { status: PatientStatus; label: string; note: string; level: "red" | "yellow" | null } {
  if (p.openAlerts > 0) {
    const level = p.openAlertLevel ?? "yellow";
    return { status: "alert", label: level === "red" ? "Red" : "Yellow", note: `${p.openAlerts} open`, level };
  }
  if (p.lastReadingAt === null) return { status: "nodata", label: "No data", note: "no readings yet", level: null };
  if (now - Date.parse(p.lastReadingAt) > NO_DATA_AFTER_MS) {
    return {
      status: "nodata",
      label: "No data",
      note: `last reading ${formatAgo(now - Date.parse(p.lastReadingAt))}`,
      level: null,
    };
  }
  // No open alert is not the same as "green": the list says only what it knows
  return { status: "normal", label: "No alerts", note: "none open", level: null };
}

const STATUS_ORDER: Record<PatientStatus, number> = { alert: 0, normal: 1, nodata: 2 };

/** Red alerts first, then yellow (most open first), then the rest, then patients with no recent data. */
export function sortRoster(patients: RosterPatient[], now: number): RosterPatient[] {
  return [...patients].sort((a, b) => {
    const sa = rosterStatus(a, now);
    const sb = rosterStatus(b, now);
    return (
      STATUS_ORDER[sa.status] - STATUS_ORDER[sb.status] ||
      Number(sb.level === "red") - Number(sa.level === "red") ||
      b.openAlerts - a.openAlerts ||
      a.name.localeCompare(b.name)
    );
  });
}

// ------------------------------------------------------------------ formatting

export function formatAgo(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** "Today 11:42", "Yesterday 21:15", or "Nov 12, 03:10". */
export function formatWhen(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (sameDay(d, new Date(now))) return `Today ${time}`;
  if (sameDay(d, new Date(now - 24 * HOUR))) return `Yesterday ${time}`;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

export function formatDay(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  if (sameDay(d, new Date(now))) return "Today";
  if (sameDay(d, new Date(now - 24 * HOUR))) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

// ------------------------------------------------------------------ vitals

const DEF = Object.fromEntries(VITAL_DEFINITIONS.map((d) => [d.type, d])) as Record<
  VitalType,
  (typeof VITAL_DEFINITIONS)[number]
>;

export const vitalLabel = (type: VitalType) => DEF[type].label;
export const vitalDecimals = (type: VitalType) => DEF[type].decimals;
export const vitalAccent = (type: VitalType) => DEF[type].accent;

export const formatValue = (type: VitalType, value: number) => value.toFixed(DEF[type].decimals);

/** What the dashed line on a chart means (it is a reference, not where an alert starts). */
export const describeLimit = (t: Threshold) => t.label;

/** How much the average has to move between the first and last third of a range to count as a trend. */
const TREND_TOLERANCE: Record<VitalType, number> = { hr: 3, bt: 0.2, bo: 1 };

/** Compares the first and last third of the points: "rising", "falling" or "stable". */
export function trendDirection(type: VitalType, points: TrendPoint[]): "rising" | "falling" | "stable" | null {
  if (points.length < 6) return null;
  const third = Math.floor(points.length / 3);
  const mean = (ps: TrendPoint[]) => ps.reduce((n, p) => n + p.avg, 0) / ps.length;
  const change = mean(points.slice(-third)) - mean(points.slice(0, third));
  if (Math.abs(change) < TREND_TOLERANCE[type]) return "stable";
  return change > 0 ? "rising" : "falling";
}

// ------------------------------------------------------------------ summary

export type SummaryInput = {
  range: { phrase: string };
  summary: Record<VitalType, VitalSummary>;
  previous: Record<VitalType, VitalSummary>;
  alerts: Alert[];
  symptoms: Symptom[];
  checkups: CheckupSummary[];
  now: number;
};

const pct = (now: number, before: number) => ((now - before) / before) * 100;

function vitalBullet(type: VitalType, cur: VitalSummary, prev: VitalSummary): string | null {
  if (cur.avg === null || cur.count === 0) return null;
  const d = DEF[type];
  let text = `${d.label}: average ${cur.avg.toFixed(d.decimals)} ${cur.unit}, from ${cur.min!.toFixed(d.decimals)} to ${cur.max!.toFixed(d.decimals)}`;
  if (prev.avg !== null && prev.count > 0 && prev.avg !== 0) {
    const change = pct(cur.avg, prev.avg);
    if (Math.abs(change) >= 1) {
      text += `, ${Math.abs(change).toFixed(0)}% ${change > 0 ? "higher" : "lower"} than the period before`;
    } else {
      text += ", about the same as the period before";
    }
  }
  return `${text}.`;
}

/**
 * The summary is written from the numbers on the page, with plain rules; nothing in it is model
 * generated, so it can be read as a quick tally and not as an assessment.
 */
export function summaryBullets({ summary, previous, alerts, symptoms, checkups, now }: SummaryInput): string[] {
  const bullets: string[] = [];

  for (const type of ["hr", "bt", "bo"] as const) {
    const b = vitalBullet(type, summary[type], previous[type]);
    if (b) bullets.push(b);
  }
  if (bullets.length === 0) bullets.push("No readings were recorded in this period.");

  if (alerts.length === 0) {
    bullets.push("No health alerts.");
  } else {
    const open = alerts.filter((a) => a.status === "open").length;
    const red = alerts.filter((a) => a.level === "red").length;
    const titles = [...new Set(alerts.map((a) => a.title))].join(", ");
    bullets.push(
      `${alerts.length} health ${alerts.length === 1 ? "alert" : "alerts"} (${red} red, ${alerts.length - red} yellow: ${titles}); ${open === 0 ? "all acknowledged" : `${open} still open`}.`,
    );
  }

  if (symptoms.length > 0) {
    const counts = new Map<string, number>();
    symptoms.forEach((s) => counts.set(s.name, (counts.get(s.name) ?? 0) + 1));
    const [top, topCount] = [...counts].sort((a, b) => b[1] - a[1])[0];
    const worst = Math.max(...symptoms.map((s) => s.intensity));
    bullets.push(
      `${symptoms.length} ${symptoms.length === 1 ? "symptom" : "symptoms"} logged; most often ${top.toLowerCase()} (${topCount}). Highest severity ${worst}/5.`,
    );
  } else {
    bullets.push("No symptoms logged.");
  }

  const done = checkups.filter((c) => c.status === "completed").length;
  const overdue = checkups.filter((c) => c.status === "assigned" && c.dueAt && Date.parse(c.dueAt) < now).length;
  if (checkups.length > 0) {
    bullets.push(
      `${done} of ${checkups.length} check-ups you assigned completed${overdue > 0 ? `, ${overdue} overdue` : ""}.`,
    );
  }
  return bullets;
}

// ------------------------------------------------------------------ check-ups

export type CheckupTemplate = { id: string; name: string; description?: string; questions: string[] };

export const CHECKUP_TEMPLATES: CheckupTemplate[] = [
  {
    id: "sleep",
    name: "Sleep quality questionnaire",
    questions: [
      "How many hours did you sleep last night?",
      "How would you rate your sleep from 1 (poor) to 5 (great)?",
      "Did you wake up during the night? If so, how many times?",
      "Do you feel rested this morning?",
    ],
  },
  {
    id: "resting-hr",
    name: "Resting heart rate check",
    description: "Sit quietly for five minutes with the cuff on before you answer.",
    questions: [
      "How do you feel after resting for five minutes?",
      "Did you notice your heart racing, pounding or skipping a beat today?",
      "Have you had caffeine or exercised in the last two hours?",
    ],
  },
  {
    id: "hydration",
    name: "Hydration and weight log",
    questions: [
      "About how much water have you had today (in glasses)?",
      "What is your weight this morning (kg)?",
      "Do you feel thirsty, dizzy or light-headed?",
    ],
  },
  {
    id: "symptoms",
    name: "Symptom review",
    questions: [
      "Which symptoms have you had since your last check-up?",
      "How strong were they on a scale from 1 to 5?",
      "Has anything made them better or worse?",
    ],
  },
];

export type DueChoice = "today" | "tomorrow" | "3d" | "1w" | "none";

export const DUE_CHOICES: { id: DueChoice; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "3d", label: "In 3 days" },
  { id: "1w", label: "In 1 week" },
  { id: "none", label: "No due date" },
];

/** End of the chosen day (local time) as an ISO timestamp, or undefined for no due date. */
export function dueDate(choice: DueChoice, now = new Date()): string | undefined {
  if (choice === "none") return undefined;
  const days = { today: 0, tomorrow: 1, "3d": 3, "1w": 7 }[choice];
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 23, 59, 0);
  // "Today" late in the evening would already be in the past.
  if (end.getTime() <= now.getTime() + 60_000) end.setDate(end.getDate() + 1);
  return end.toISOString();
}

export type CheckupState = { label: string; tone: "due" | "done" | "late" | "open" };

export function checkupState(c: CheckupSummary, now = Date.now()): CheckupState {
  if (c.status === "completed") {
    return { label: `Done, ${formatDay(c.completedAt ?? c.assignedAt, now).toLowerCase()}`, tone: "done" };
  }
  if (!c.dueAt) return { label: "Assigned", tone: "open" };
  const due = new Date(c.dueAt);
  if (due.getTime() < now) return { label: `Missed, ${formatDay(c.dueAt, now).toLowerCase()}`, tone: "late" };
  if (sameDay(due, new Date(now))) return { label: "Due today", tone: "due" };
  return { label: `Due ${formatDay(c.dueAt, now)}`, tone: "open" };
}

// ------------------------------------------------------------------ export

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per time bucket, one column per vital (the bucket averages shown on the charts). */
export function trendsToCsv(trends: Record<VitalType, Trend>): string {
  const types: VitalType[] = ["hr", "bt", "bo"];
  const times = [...new Set(types.flatMap((t) => trends[t].points.map((p) => p.t)))].sort();
  const lookup = Object.fromEntries(
    types.map((t) => [t, new Map(trends[t].points.map((p) => [p.t, p.avg]))]),
  ) as Record<VitalType, Map<string, number>>;

  const header = ["time_utc", ...types.map((t) => `${DEF[t].label} avg (${trends[t].unit})`)];
  const rows = times.map((time) => [
    time,
    ...types.map((t) => (lookup[t].has(time) ? lookup[t].get(time)!.toFixed(DEF[t].decimals + 1) : "")),
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export type { Latest };
