import { describe, expect, it } from 'vitest';
import { groupEpisodes, MERGE_GAP_MINUTES, STEP_MINUTES } from '../src/modules/alerts/episodes.js';
import type { Step } from '../src/modules/metrics/service.js';
import { MINUTE, type AlertItem } from '../src/modules/metrics/types.js';

const T0 = Date.UTC(2026, 10, 14, 10, 0, 0);
const item = (ruleId: string, level: 'yellow' | 'red', reason = `${ruleId} ${level}`): AlertItem => ({
    ruleId,
    kind: 'metric',
    title: ruleId,
    level,
    reason,
    recommendedAction: `act on ${ruleId}`,
    escalateTo: level === 'red' ? 'crew medical officer' : null,
    evidenceLevel: 'OUR_HEURISTIC',
});
/** A step `n` steps after T0, with the given items. */
const step = (n: number, ...items: AlertItem[]): Step => ({ t: T0 + n * STEP_MINUTES * MINUTE, items });

describe('groupEpisodes', () => {
    it('turns a run of non-green steps into one alert with its start, end and length', () => {
        const [e] = groupEpisodes([step(0), step(1, item('hr_resting', 'yellow')), step(2, item('hr_resting', 'yellow')), step(3, item('hr_resting', 'yellow')), step(4), step(10), step(11)]);
        expect(e).toMatchObject({ ruleId: 'hr_resting', level: 'yellow', durationMinutes: 15, ongoing: false });
        expect(e.startedAt).toEqual(new Date(T0 + 5 * MINUTE));
        expect(e.endedAt).toEqual(new Date(T0 + 20 * MINUTE));
    });

    it('is empty when nothing was ever yellow or red', () => {
        expect(groupEpisodes([step(0), step(1), step(2)])).toEqual([]);
        expect(groupEpisodes([])).toEqual([]);
    });

    it('groups a yellow that turns red into one alert at the higher level, described by the red step', () => {
        const eps = groupEpisodes([
            step(0, item('spo2', 'yellow', 'low')),
            step(1, item('spo2', 'yellow', 'low')),
            step(2, item('spo2', 'red', 'very low')),
            step(3, item('spo2', 'yellow', 'low')),
        ]);
        expect(eps).toHaveLength(1);
        expect(eps[0]).toMatchObject({ level: 'red', reason: 'very low', escalateTo: 'crew medical officer', durationMinutes: 20 });
        expect(eps[0].startedAt).toEqual(new Date(T0));
    });

    it('does not split an alert for a dip of up to 15 minutes, and does for a longer one', () => {
        const dip = (greens: number) => groupEpisodes([step(0, item('bp', 'yellow')), ...Array.from({ length: greens }, (_, i) => step(i + 1)), step(greens + 1, item('bp', 'yellow'))]);
        expect(MERGE_GAP_MINUTES).toBe(15);
        expect(dip(2)).toHaveLength(1); // 15 minutes between the two yellow steps
        expect(dip(3)).toHaveLength(2); // 20 minutes
        // the quiet steps in between do not count towards the length
        expect(dip(2)[0].durationMinutes).toBe(20);
    });

    it('keeps rules apart', () => {
        const eps = groupEpisodes([step(0, item('hr_resting', 'yellow'), item('skin_temp', 'yellow')), step(1, item('hr_resting', 'yellow'), item('skin_temp', 'yellow'), item('volume_loss_or_infection', 'red'))]);
        expect(eps.map((e) => e.ruleId).sort()).toEqual(['hr_resting', 'skin_temp', 'volume_loss_or_infection']);
        expect(eps.find((e) => e.ruleId === 'volume_loss_or_infection')?.startedAt).toEqual(new Date(T0 + 5 * MINUTE));
    });

    it('marks an alert that reaches the latest step as ongoing', () => {
        expect(groupEpisodes([step(0), step(1, item('bp', 'red')), step(2, item('bp', 'red'))])[0].ongoing).toBe(true);
        expect(groupEpisodes([step(0, item('bp', 'red')), step(1), step(2)])[0].ongoing).toBe(false);
    });

    it('carries one recommended action and the evidence label with every alert', () => {
        const [e] = groupEpisodes([step(0, item('bp', 'yellow'))]);
        expect(e.recommendedAction).toBe('act on bp');
        expect(e.evidenceLevel).toBe('OUR_HEURISTIC');
        expect(e.escalateTo).toBeNull();
    });
});
