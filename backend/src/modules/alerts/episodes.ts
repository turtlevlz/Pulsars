import { breaches, type Threshold } from '../vitals/thresholds.js';
import type { Bucket } from '../vitals/buckets.js';

// How alerts are worked out. Readings are first averaged into one-minute buckets, and a bucket
// counts as a breach when its *average* is past the limit, so one jumpy reading (a moved
// finger, a poor contact) can't raise an alert. An episode is a run of back-to-back breaching
// minutes, and only runs of at least MIN_MINUTES count. A minute with no readings ends a run:
// nothing is assumed about time the cuff was not on.
export const BUCKET_SECONDS = 60;
export const MIN_MINUTES = 2;

export interface Episode {
    /** Start of the first breaching minute; with the patient and vital type it identifies the episode. */
    startedAt: Date;
    /** End of the last breaching minute so far. */
    endedAt: Date;
    durationMinutes: number;
    /** The worst minute average in the episode (highest for an upper limit, lowest for a lower one). */
    peak: number;
    /** True while the latest breaching minute is still recent, so the episode may still be growing. */
    ongoing: boolean;
}

export function findEpisodes(buckets: Bucket[], threshold: Threshold, now = new Date()): Episode[] {
    const step = BUCKET_SECONDS * 1000;
    const episodes: Episode[] = [];
    let run: Bucket[] = [];

    const close = () => {
        if (run.length >= MIN_MINUTES) {
            const values = run.map((b) => b.avg);
            const last = run[run.length - 1].t.getTime() + step;
            episodes.push({
                startedAt: run[0].t,
                endedAt: new Date(last),
                durationMinutes: run.length,
                peak: threshold.bound === 'upper' ? Math.max(...values) : Math.min(...values),
                // the minute that just ended or is still filling in counts as "now"
                ongoing: now.getTime() - last < 2 * step,
            });
        }
        run = [];
    };

    for (const bucket of buckets) {
        const contiguous = run.length === 0 || bucket.t.getTime() - run[run.length - 1].t.getTime() === step;
        if (!breaches(threshold, bucket.avg)) {
            close();
        } else {
            if (!contiguous) close();
            run.push(bucket);
        }
    }
    close();
    return episodes;
}
