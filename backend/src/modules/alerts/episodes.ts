import { MINUTE, type AlertItem } from '../metrics/types.js';
import type { Step } from '../metrics/service.js';

// How alerts are made (spec section 6). The engine judges every few minutes (a "step"); an
// alert is a stretch of steps where one rule was yellow or red.
//  - Persistence is already in the evaluators (30 resting minutes, three SpO2 minutes, ...), so
//    an alert starts at the first step where the tier was reached, not at the first odd reading.
//  - Grouping: a short dip back to green or gray (up to MERGE_GAP_MINUTES) does not split it, and
//    a yellow that later turns red is one alert whose level is raised. That is what keeps one
//    illness from being ten alerts.
//  - One recommended action per alert: the one that belongs to the worst level it reached.
export const STEP_MINUTES = 5;
export const MERGE_GAP_MINUTES = 15;

export interface Episode extends AlertItem {
    /** First step at yellow or red; with the patient and rule it identifies the alert. */
    startedAt: Date;
    /** End of the last step in it. */
    endedAt: Date;
    durationMinutes: number;
    /** True while the latest step is still in it, so the alert may still be growing. */
    ongoing: boolean;
}

export function groupEpisodes(steps: Step[], stepMinutes = STEP_MINUTES, mergeGapMinutes = MERGE_GAP_MINUTES): Episode[] {
    const stepMs = stepMinutes * MINUTE;
    const lastStep = steps.length > 0 ? steps[steps.length - 1].t : null;
    const open = new Map<string, { start: number; lastActive: number; item: AlertItem }>();
    const done: Episode[] = [];

    const close = (ruleId: string) => {
        const e = open.get(ruleId)!;
        open.delete(ruleId);
        const endedAt = e.lastActive + stepMs;
        done.push({
            ...e.item,
            startedAt: new Date(e.start),
            endedAt: new Date(endedAt),
            durationMinutes: Math.round((endedAt - e.start) / MINUTE),
            ongoing: e.lastActive === lastStep,
        });
    };

    for (const step of steps) {
        for (const item of step.items) {
            const e = open.get(item.ruleId);
            if (e && step.t - e.lastActive <= mergeGapMinutes * MINUTE) {
                e.lastActive = step.t;
                // the worst level reached is the one that is described
                if (item.level === 'red' && e.item.level !== 'red') e.item = item;
            } else {
                if (e) close(item.ruleId);
                open.set(item.ruleId, { start: step.t, lastActive: step.t, item });
            }
        }
        for (const [ruleId, e] of [...open]) {
            if (step.t - e.lastActive > mergeGapMinutes * MINUTE) close(ruleId);
        }
    }
    for (const ruleId of [...open.keys()]) close(ruleId);
    return done;
}
