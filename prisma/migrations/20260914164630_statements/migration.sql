-- AlterTable: one row per stock and statement (fundamentals, income, cashflow, balance)
ALTER TABLE "fundamentals" ADD COLUMN "statement" VARCHAR(16) NOT NULL DEFAULT 'fundamentals';

-- DropIndex: security_id alone is no longer unique
DROP INDEX "fundamentals_security_id_key";

-- CreateIndex
CREATE UNIQUE INDEX "fundamentals_security_id_statement_key" ON "fundamentals"("security_id", "statement");
