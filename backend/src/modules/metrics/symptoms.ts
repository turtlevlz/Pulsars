import { metricsConfig } from './config.js';

const norm = (s: string) => s.trim().toLowerCase();

const byName = new Map<string, string>();
for (const s of metricsConfig.symptoms) {
    byName.set(norm(s.id), s.id);
    byName.set(norm(s.label), s.id);
    for (const alias of s.aliases) byName.set(norm(alias), s.id);
}

/** The picklist symptom a free-text name stands for, or null if it is not one of them. */
export const matchSymptom = (name: string): string | null => byName.get(norm(name)) ?? null;

export const symptomLabel = (id: string) => metricsConfig.symptoms.find((s) => s.id === id)?.label ?? id;
export const isRedFlag = (id: string | null) => id !== null && metricsConfig.symptoms.some((s) => s.id === id && s.red_flag);
export const isHeartSymptom = (id: string | null) => id !== null && metricsConfig.heart_symptoms.includes(id);

const logSymptom = (id: string) => metricsConfig.log_symptoms.find((s) => s.id === id);
export const logSymptomLabel = (id: string) => logSymptom(id)?.label ?? id;
/** `red`: always a red flag. `presyncope`: red only together with a low pressure or a drop on standing. */
export const logSymptomEffect = (id: string) => logSymptom(id)?.effect ?? null;
