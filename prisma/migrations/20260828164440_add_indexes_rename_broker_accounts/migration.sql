-- Rename broker_account -> broker_accounts (plural, consistent with every other table).
-- Written as ALTER ... RENAME rather than the DROP + CREATE Prisma generates,
-- so the table's data and its foreign keys survive the rename.

-- RenameTable
ALTER TABLE "broker_account" RENAME TO "broker_accounts";

-- RenameConstraint: Postgres keeps the old names after a table rename
ALTER TABLE "broker_accounts" RENAME CONSTRAINT "broker_account_pkey" TO "broker_accounts_pkey";
ALTER TABLE "broker_accounts" RENAME CONSTRAINT "broker_account_user_id_fkey" TO "broker_accounts_user_id_fkey";

-- RenameIndex
ALTER INDEX "broker_account_user_id_broker_client_code_key" RENAME TO "broker_accounts_user_id_broker_client_code_key";

-- Trades are append-only history: never let deleting a broker account
-- silently strip the lineage off executions. Restrict, don't SET NULL.
-- DropForeignKey
ALTER TABLE "trades" DROP CONSTRAINT "trades_broker_account_id_fkey";

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_broker_account_id_fkey" FOREIGN KEY ("broker_account_id") REFERENCES "broker_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Postgres does not auto-index foreign key columns; add the ones joins actually use.
-- daily_prices.security_id is already covered as the leading column of its composite unique.

-- CreateIndex
CREATE INDEX "broker_accounts_user_id_idx" ON "broker_accounts"("user_id");

-- CreateIndex
CREATE INDEX "portfolios_user_id_idx" ON "portfolios"("user_id");

-- CreateIndex
CREATE INDEX "positions_security_id_idx" ON "positions"("security_id");

-- CreateIndex
CREATE INDEX "trades_security_id_idx" ON "trades"("security_id");

-- The index behind "all trades in my portfolio, newest first" and the
-- chronological replay that rebuilds positions.
-- CreateIndex
CREATE INDEX "trades_portfolio_id_executed_at_idx" ON "trades"("portfolio_id", "executed_at" DESC);
