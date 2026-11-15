import type { VitalType } from './types.js';

// Reference limits for the medic dashboard's dashed lines and threshold alerts. They are plain
// defaults (the same for every patient), kept in this one place so they are easy to change.
// The wearable's readings are demo-grade: SpO2 is experimental and the temperature is taken on
// the skin, so a breach is a prompt to look, not a diagnosis.
export interface Threshold {
    /** `upper`: a reading above `limit` breaches it. `lower`: a reading below it does. */
    bound: 'upper' | 'lower';
    limit: number;
}

export const THRESHOLDS: Record<VitalType, Threshold> = {
    hr: { bound: 'upper', limit: 100 },
    bt: { bound: 'upper', limit: 37.8 },
    bo: { bound: 'lower', limit: 92 },
};

export const breaches = (t: Threshold, value: number) => (t.bound === 'upper' ? value > t.limit : value < t.limit);
