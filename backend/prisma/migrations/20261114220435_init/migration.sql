-- CreateEnum
CREATE TYPE "Role" AS ENUM ('patient', 'medic');

-- CreateEnum
CREATE TYPE "Frequency" AS ENUM ('once', 'daily', 'several_daily', 'weekly', 'constant');

-- CreateEnum
CREATE TYPE "CheckupStatus" AS ENUM ('assigned', 'completed');

-- CreateEnum
CREATE TYPE "ThreadStatus" AS ENUM ('open', 'done');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('assistant', 'patient');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'patient',
    "weight" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "age" INTEGER,
    "avg_hr" DOUBLE PRECISION,
    "avg_bt" DOUBLE PRECISION,
    "avg_bo" DOUBLE PRECISION,
    "hr_count" INTEGER NOT NULL DEFAULT 0,
    "bt_count" INTEGER NOT NULL DEFAULT 0,
    "bo_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "heart_rates" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "heart_rate" DOUBLE PRECISION NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "heart_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "body_temps" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "body_temp" DOUBLE PRECISION NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "body_temps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blood_oxygens" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "blood_o" DOUBLE PRECISION NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blood_oxygens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "symptoms" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "intensity" INTEGER NOT NULL,
    "notes" TEXT,
    "duration_minutes" INTEGER,
    "frequency" "Frequency" NOT NULL,
    "logged_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "symptoms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkups" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "medic_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "CheckupStatus" NOT NULL DEFAULT 'assigned',
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" SERIAL NOT NULL,
    "checkup_id" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "followup_threads" (
    "id" SERIAL NOT NULL,
    "symptom_id" INTEGER NOT NULL,
    "status" "ThreadStatus" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "followup_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "followup_messages" (
    "id" SERIAL NOT NULL,
    "thread_id" INTEGER NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "followup_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "heart_rates_user_id_recorded_at_key" ON "heart_rates"("user_id", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "body_temps_user_id_recorded_at_key" ON "body_temps"("user_id", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "blood_oxygens_user_id_recorded_at_key" ON "blood_oxygens"("user_id", "recorded_at");

-- CreateIndex
CREATE INDEX "symptoms_user_id_logged_at_idx" ON "symptoms"("user_id", "logged_at");

-- CreateIndex
CREATE INDEX "checkups_user_id_status_idx" ON "checkups"("user_id", "status");

-- CreateIndex
CREATE INDEX "checkups_medic_id_idx" ON "checkups"("medic_id");

-- CreateIndex
CREATE INDEX "questions_checkup_id_idx" ON "questions"("checkup_id");

-- CreateIndex
CREATE INDEX "followup_threads_symptom_id_idx" ON "followup_threads"("symptom_id");

-- CreateIndex
CREATE INDEX "followup_messages_thread_id_created_at_idx" ON "followup_messages"("thread_id", "created_at");

-- AddForeignKey
ALTER TABLE "heart_rates" ADD CONSTRAINT "heart_rates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "body_temps" ADD CONSTRAINT "body_temps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_oxygens" ADD CONSTRAINT "blood_oxygens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "symptoms" ADD CONSTRAINT "symptoms_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkups" ADD CONSTRAINT "checkups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkups" ADD CONSTRAINT "checkups_medic_id_fkey" FOREIGN KEY ("medic_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_checkup_id_fkey" FOREIGN KEY ("checkup_id") REFERENCES "checkups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followup_threads" ADD CONSTRAINT "followup_threads_symptom_id_fkey" FOREIGN KEY ("symptom_id") REFERENCES "symptoms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followup_messages" ADD CONSTRAINT "followup_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "followup_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Not expressible in Prisma schema: symptom intensity must be 1-5.
ALTER TABLE "symptoms" ADD CONSTRAINT "symptoms_intensity_check" CHECK ("intensity" BETWEEN 1 AND 5);
