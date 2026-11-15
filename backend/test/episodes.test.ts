import { describe, expect, it } from 'vitest';
import { findEpisodes } from '../src/modules/alerts/episodes.js';
import type { Bucket } from '../src/modules/vitals/buckets.js';

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 14, 10, 0, 0);
const bucket = (minute: number, avg: number): Bucket => ({ t: new Date(T0 + minute * MIN), avg, min: avg, max: avg, count: 60 });
const upper = { bound: 'upper', limit: 100 } as const;
const lower = { bound: 'lower', limit: 92 } as const;
const later = new Date(T0 + 24 * 3600_000);

describe('findEpisodes', () => {
    it('finds a run of breaching minutes and reports its start, length and peak', () => {
        const episodes = findEpisodes([bucket(0, 80), bucket(1, 104), bucket(2, 110), bucket(3, 102), bucket(4, 85)], upper, later);
        expect(episodes).toHaveLength(1);
        expect(episodes[0]).toMatchObject({ durationMinutes: 3, peak: 110, ongoing: false });
        expect(episodes[0].startedAt).toEqual(new Date(T0 + 1 * MIN));
        expect(episodes[0].endedAt).toEqual(new Date(T0 + 4 * MIN));
    });

    it('needs the average to be past the limit: equal to it is not a breach', () => {
        expect(findEpisodes([bucket(0, 100), bucket(1, 100), bucket(2, 100)], upper, later)).toEqual([]);
        expect(findEpisodes([bucket(0, 92), bucket(1, 92)], lower, later)).toEqual([]);
    });

    it('ignores a single breaching minute (a blip), and counts two in a row', () => {
        expect(findEpisodes([bucket(0, 90), bucket(1, 120), bucket(2, 90)], upper, later)).toEqual([]);
        expect(findEpisodes([bucket(0, 90), bucket(1, 120), bucket(2, 120), bucket(3, 90)], upper, later)).toHaveLength(1);
    });

    it('uses the lowest minute as the peak for a lower limit', () => {
        const [episode] = findEpisodes([bucket(0, 91), bucket(1, 88), bucket(2, 90)], lower, later);
        expect(episode.peak).toBe(88);
    });

    it('splits episodes at a healthy minute and at a gap in the data', () => {
        const healthy = findEpisodes([bucket(0, 110), bucket(1, 110), bucket(2, 80), bucket(3, 110), bucket(4, 110)], upper, later);
        expect(healthy).toHaveLength(2);
        // minute 2 is missing altogether: the cuff was off, so the run does not continue across it
        const gap = findEpisodes([bucket(0, 110), bucket(1, 110), bucket(3, 110), bucket(4, 110)], upper, later);
        expect(gap.map((e) => e.durationMinutes)).toEqual([2, 2]);
    });

    it('marks an episode that reaches the present as ongoing', () => {
        const now = new Date(T0 + 3 * MIN + 20_000);
        const [episode] = findEpisodes([bucket(1, 110), bucket(2, 110), bucket(3, 110)], upper, now);
        expect(episode.ongoing).toBe(true);
        const [old] = findEpisodes([bucket(1, 110), bucket(2, 110)], upper, new Date(T0 + 30 * MIN));
        expect(old.ongoing).toBe(false);
    });

    it('finds nothing in no data', () => {
        expect(findEpisodes([], upper, later)).toEqual([]);
    });
});
