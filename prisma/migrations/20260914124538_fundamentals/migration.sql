-- CreateTable
CREATE TABLE "fundamentals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "security_id" UUID NOT NULL,
    "interval" VARCHAR(16) NOT NULL,
    "payload" JSONB NOT NULL,
    "provider_at" TIMESTAMPTZ,
    "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fundamentals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fundamentals_security_id_key" ON "fundamentals"("security_id");

-- AddForeignKey
ALTER TABLE "fundamentals" ADD CONSTRAINT "fundamentals_security_id_fkey" FOREIGN KEY ("security_id") REFERENCES "securities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
