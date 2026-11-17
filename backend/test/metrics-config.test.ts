import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EVIDENCE_LEVELS, metricsConfig, parseMetricsConfig, profileById } from '../src/modules/metrics/config.js';

// Thresholds are data (spec section 3). These tests are what keeps that data honest: every row says
// where it comes from, what it cannot do and what to do about it, and a broken file fails loudly.

const raw = () => JSON.parse(readFileSync(new URL('../config/metrics.json', import.meta.url), 'utf8'));

describe('config/metrics.json', () => {
    it('parses, and every metric row carries evidence, sources, limitation and an action', () => {
        expect(metricsConfig.metrics.map((m) => m.metric_id)).toEqual(['hr_resting', 'skin_temp', 'spo2', 'bp', 'sleep', 'orthostatic', 'symptoms']);
        for (const m of metricsConfig.metrics) {
            expect(EVIDENCE_LEVELS, m.metric_id).toContain(m.evidence_level);
            expect(m.sources.length, m.metric_id).toBeGreaterThan(0);
            expect(m.limitation.length, m.metric_id).toBeGreaterThan(10);
            expect(m.action.yellow.length, m.metric_id).toBeGreaterThan(5);
            expect(m.action.red.length, m.metric_id).toBeGreaterThan(5);
            expect(m.tiers.green && m.tiers.yellow && m.tiers.red, m.metric_id).toBeTruthy();
            expect(m.explain.how && m.explain.meaning && m.explain.why, m.metric_id).toBeTruthy();
            expect(m.stale_after_minutes, m.metric_id).toBeGreaterThan(0);
        }
    });

    it('labels the tiers as proposals and no row claims to be a NASA limit', () => {
        expect(metricsConfig.disclaimer).toMatch(/not NASA limits/i);
        expect(metricsConfig.metrics.filter((m) => m.evidence_level === 'NASA_STANDARD')).toEqual([]);
        expect(metricsConfig.metrics.find((m) => m.metric_id === 'hr_resting')?.evidence_level).toBe('OUR_HEURISTIC');
    });

    it('has the environment profiles, with gravity only on the surface ones', () => {
        expect(metricsConfig.profiles.map((p) => [p.id, p.gravity])).toEqual([
            ['station', false],
            ['spacecraft', false],
            ['rover', true],
            ['moon', true],
            ['mars', true],
        ]);
        expect(profileById(metricsConfig.default_profile)?.gravity).toBe(false);
    });

    it('has the symptom picklist with its red flags', () => {
        const flags = metricsConfig.symptoms.filter((s) => s.red_flag).map((s) => s.id);
        expect(flags).toEqual(['vision_change', 'chest_pain', 'fainting']);
        expect(metricsConfig.symptoms.map((s) => s.label)).toEqual(
            expect.arrayContaining(['Headache', 'Dizziness', 'Nausea / motion sickness', 'GI symptoms', 'Chest pain', 'Fainting', 'Shortness of breath']),
        );
    });

    it('rejects a metric without an evidence level, a source or an action', () => {
        const missing = (edit: (c: ReturnType<typeof raw>) => void) => {
            const c = raw();
            edit(c);
            return () => parseMetricsConfig(c);
        };
        expect(missing((c) => delete c.metrics[0].evidence_level)).toThrow();
        expect(missing((c) => (c.metrics[1].evidence_level = 'MADE_UP'))).toThrow();
        expect(missing((c) => (c.metrics[2].sources = []))).toThrow();
        expect(missing((c) => delete c.metrics[3].limitation)).toThrow();
        expect(missing((c) => delete c.metrics[4].action.red)).toThrow();
        expect(missing((c) => delete c.metrics[0].params.red_high)).toThrow(); // a threshold the engine needs
        expect(missing((c) => (c.metrics[0].params.unknown = 1))).toThrow(); // and nothing it does not know
    });

    it('rejects a broken cross-check: an unknown default profile, an active rule without an action', () => {
        const edit = (f: (c: ReturnType<typeof raw>) => void) => {
            const c = raw();
            f(c);
            return () => parseMetricsConfig(c);
        };
        expect(edit((c) => (c.default_profile = 'jupiter'))).toThrow(/default_profile/);
        expect(edit((c) => delete c.rules[0].action)).toThrow(/needs an action/);
        expect(edit((c) => delete c.rules[1].inactive_reason)).toThrow(/inactive_reason/);
        expect(edit((c) => (c.heart_symptoms = ['nope']))).toThrow(/unknown symptom/);
    });

    it('is valid as shipped', () => {
        expect(() => parseMetricsConfig(raw())).not.toThrow();
    });
});
