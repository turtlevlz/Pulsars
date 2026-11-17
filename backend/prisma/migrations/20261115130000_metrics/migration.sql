-- Astronaut health metrics, phase 1 (docs/plan.md, "Health metrics (as built)").

-- Where the person is: decides which checks are enabled (the orthostatic check needs gravity).
ALTER TABLE "users" ADD COLUMN "environment_profile" VARCHAR(16) NOT NULL DEFAULT 'station';

-- Manual entries (blood pressure, sleep, core temperature, exercise, orthostatic check).
CREATE TABLE "log_entries" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "log_entries_user_id_kind_recorded_at_idx" ON "log_entries"("user_id", "kind", "recorded_at" DESC);

ALTER TABLE "log_entries" ADD CONSTRAINT "log_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Personal set points, recomputed lazily.
CREATE TABLE "baselines" (
    "user_id" INTEGER NOT NULL,
    "metric_id" VARCHAR(64) NOT NULL,
    "rule" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "baselines_pkey" PRIMARY KEY ("user_id", "metric_id")
);

ALTER TABLE "baselines" ADD CONSTRAINT "baselines_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Acknowledgements now belong to a rule (a metric id or a cross rule) instead of a vital type.
ALTER TABLE "alert_acknowledgements" ALTER COLUMN "type" TYPE VARCHAR(64);
UPDATE "alert_acknowledgements" SET "type" = CASE "type" WHEN 'hr' THEN 'hr_resting' WHEN 'bt' THEN 'skin_temp' WHEN 'bo' THEN 'spo2' ELSE "type" END;
ALTER TABLE "alert_acknowledgements" RENAME COLUMN "type" TO "rule_id";
ALTER INDEX "alert_acknowledgements_user_id_type_started_at_key" RENAME TO "alert_acknowledgements_user_id_rule_id_started_at_key";
