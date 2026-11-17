-- CreateTable
CREATE TABLE "alert_acknowledgements" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" VARCHAR(2) NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "acknowledged_by" INTEGER,
    "acknowledged_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_acknowledgements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "alert_acknowledgements_user_id_type_started_at_key" ON "alert_acknowledgements"("user_id", "type", "started_at");

-- AddForeignKey
ALTER TABLE "alert_acknowledgements" ADD CONSTRAINT "alert_acknowledgements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_acknowledgements" ADD CONSTRAINT "alert_acknowledgements_acknowledged_by_fkey" FOREIGN KEY ("acknowledged_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
