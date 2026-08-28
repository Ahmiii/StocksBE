-- CreateTable
CREATE TABLE "securities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "symbol" VARCHAR(16) NOT NULL,
    "isin" VARCHAR(12),
    "company_name" VARCHAR(255) NOT NULL,
    "sector" VARCHAR(120),
    "listing_status" VARCHAR(16) NOT NULL DEFAULT 'listed',
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "securities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trades" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "portfolio_id" UUID NOT NULL,
    "security_id" UUID NOT NULL,
    "broker_account_id" UUID,
    "broker_trade_id" VARCHAR(64),
    "broker_order_id" VARCHAR(64),
    "side" VARCHAR(4) NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "price" DECIMAL(18,4) NOT NULL,
    "commission" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxes_levies" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(18,4) NOT NULL,
    "executed_at" TIMESTAMPTZ NOT NULL,
    "source" VARCHAR(16) NOT NULL DEFAULT 'broker_sync',
    "raw_payload" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trades_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "securities_symbol_key" ON "securities"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "securities_isin_key" ON "securities"("isin");

-- CreateIndex
CREATE UNIQUE INDEX "trades_broker_account_id_broker_trade_id_key" ON "trades"("broker_account_id", "broker_trade_id");

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_security_id_fkey" FOREIGN KEY ("security_id") REFERENCES "securities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_broker_account_id_fkey" FOREIGN KEY ("broker_account_id") REFERENCES "broker_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
