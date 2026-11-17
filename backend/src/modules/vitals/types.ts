// The three vitals live in separate tables (docs/plan.md §1). This is the only place that
// knows which table/column belongs to which type, so routes and the MQTT subscriber
// (step 6) just deal in `hr | bt | bo`.
//
// The identifier strings below are constants, never user input: they are spliced into
// raw SQL with Prisma.raw(), while every value goes through normal query parameters.
export const VITAL_TYPES = ['hr', 'bt', 'bo'] as const;
export type VitalType = (typeof VITAL_TYPES)[number];

export interface VitalConfig {
    table: string;
    column: string; // the value column in `table`
    avg: string; // lifetime-average column on users
    count: string; // reading-count column on users
    unit: string;
    min: number; // plausible range; anything outside is a sensor/data error
    max: number;
}

export const VITALS: Record<VitalType, VitalConfig> = {
    hr: { table: 'heart_rates', column: 'heart_rate', avg: 'avg_hr', count: 'hr_count', unit: 'bpm', min: 20, max: 250 },
    bt: { table: 'body_temps', column: 'body_temp', avg: 'avg_bt', count: 'bt_count', unit: '°C', min: 30, max: 45 },
    bo: { table: 'blood_oxygens', column: 'blood_o', avg: 'avg_bo', count: 'bo_count', unit: '%', min: 50, max: 100 },
};
