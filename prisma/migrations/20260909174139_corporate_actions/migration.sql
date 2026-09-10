-- CreateTable
CREATE TABLE "corporate_actions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "security_id" UUID NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "ex_date" DATE NOT NULL,
    "amount" DECIMAL(18,4),
    "ratio" DECIMAL(18,8),
    "to_security_id" UUID,
    "source" VARCHAR(16) NOT NULL,
    "provider_id" VARCHAR(32),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "corporate_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "corporate_actions_security_id_type_ex_date_key" ON "corporate_actions"("security_id", "type", "ex_date");

-- AddForeignKey
ALTER TABLE "corporate_actions" ADD CONSTRAINT "corporate_actions_security_id_fkey" FOREIGN KEY ("security_id") REFERENCES "securities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corporate_actions" ADD CONSTRAINT "corporate_actions_to_security_id_fkey" FOREIGN KEY ("to_security_id") REFERENCES "securities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
