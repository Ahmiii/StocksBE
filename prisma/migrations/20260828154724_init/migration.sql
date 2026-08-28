-- CreateTable
CREATE TABLE "portfolios" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "broker_account_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "base_currency" CHAR(3) NOT NULL DEFAULT 'PKR',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portfolios_broker_account_id_key" ON "portfolios"("broker_account_id");

-- AddForeignKey
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_broker_account_id_fkey" FOREIGN KEY ("broker_account_id") REFERENCES "broker_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
