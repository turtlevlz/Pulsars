import type { MetricsConfig } from './config.js';
import type { Level, MetricStatus, RuleStatus } from './types.js';

const RANK: Record<Level, number> = { gray: 0, green: 0, yellow: 1, red: 2 };
const LEVEL_OF = ['green', 'yellow', 'red'] as const;

/** One level worse than the worst of the contributors, never beyond red. */
export const raise = (levels: Level[], by = 1): Level => LEVEL_OF[Math.min(2, Math.max(...levels.map((l) => RANK[l])) + by)];

/**
 * Cross rules (spec section 8). Only the ones whose inputs exist are evaluated; the others are
 * declared in config/metrics.json with `active: false` and say what they are waiting for.
 *  - volume_loss_or_infection: a low blood pressure, a raised resting heart rate and a raised
 *    temperature (or a logged core fever) together. Each of the three alone may be yellow; together
 *    they are escalated one level, so this reaches red sooner than any single reading would.
 */
export function evaluateRules(statuses: MetricStatus[], config: MetricsConfig): RuleStatus[] {
    const by = new Map(statuses.map((s) => [s.metricId, s]));
    const out: RuleStatus[] = [];

    const rule = config.rules.find((r) => r.id === 'volume_loss_or_infection' && r.active);
    if (rule) {
        const bp = by.get('bp');
        const hr = by.get('hr_resting');
        const temp = by.get('skin_temp');
        const lowBp = bp !== undefined && bp.level !== 'gray' && bp.flags.includes('low');
        const fastHr = hr !== undefined && hr.level !== 'gray' && hr.flags.includes('elevated');
        const hot = temp !== undefined && temp.level !== 'gray' && (temp.flags.includes('rise') || temp.flags.includes('core_fever'));
        if (lowBp && fastHr && hot) {
            out.push({
                ruleId: rule.id,
                title: rule.title,
                level: raise([bp.level, temp.level]),
                reason: `Low blood pressure (${bp.display}), a raised resting heart rate (${hr.display}) and a raised temperature (${temp.display}) at the same time. ${rule.when}`,
                evidenceLevel: rule.evidence_level,
                action: rule.action ?? null,
                from: ['bp', 'hr_resting', 'skin_temp'],
            });
        }
    }
    return out;
}
