/*
  Warnings:

  - You are about to drop the `broker_connections` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "broker_connections" DROP CONSTRAINT "broker_connections_user_id_fkey";

-- DropForeignKey
ALTER TABLE "portfolios" DROP CONSTRAINT "portfolios_broker_account_id_fkey";

-- DropForeignKey
ALTER TABLE "trades" DROP CONSTRAINT "trades_broker_account_id_fkey";

-- DropTable
DROP TABLE "broker_connections";

-- CreateTable
CREATE TABLE "broker_account" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "broker" VARCHAR(32) NOT NULL DEFAULT 'AHL_ETRADE',
    "client_code" VARCHAR(64) NOT NULL,
    "credentials_enc" TEXT,
    "token_expires_at" TIMESTAMPTZ,
    "sync_status" VARCHAR(16) NOT NULL DEFAULT 'idle',
    "sync_cursor" VARCHAR(255),
    "last_synced_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broker_account_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "broker_account_user_id_broker_client_code_key" ON "broker_account"("user_id", "broker", "client_code");

-- AddForeignKey
ALTER TABLE "broker_account" ADD CONSTRAINT "broker_account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_broker_account_id_fkey" FOREIGN KEY ("broker_account_id") REFERENCES "broker_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_broker_account_id_fkey" FOREIGN KEY ("broker_account_id") REFERENCES "broker_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
