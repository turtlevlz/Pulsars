CREATE TABLE "fitness_windows" (
    "user_id" INTEGER NOT NULL,
    "device_id" VARCHAR(64) NOT NULL,
    "boot_id" VARCHAR(64) NOT NULL,
    "device_time_ms" BIGINT NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "bands" SMALLINT[] NOT NULL,
    "context" JSONB NOT NULL,
    CONSTRAINT "fitness_windows_pkey" PRIMARY KEY ("user_id", "device_id", "boot_id", "device_time_ms"),
    CONSTRAINT "fitness_windows_user_id_fkey" FOREIGN KEY ("user_id")
        REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "fitness_windows_user_id_recorded_at_idx" ON "fitness_windows"("user_id", "recorded_at");

CREATE TABLE "routine_completions" (
    "user_id" INTEGER NOT NULL,
    "routine_key" VARCHAR(32) NOT NULL,
    "local_date" VARCHAR(10) NOT NULL,
    "completed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "routine_completions_pkey" PRIMARY KEY ("user_id", "routine_key", "local_date"),
    CONSTRAINT "routine_completions_user_id_fkey" FOREIGN KEY ("user_id")
        REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "routine_completions_user_id_completed_at_idx" ON "routine_completions"("user_id", "completed_at");
