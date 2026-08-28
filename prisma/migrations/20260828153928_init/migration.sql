-- CreateTable
CREATE TABLE "broker_connections" (
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

    CONSTRAINT "broker_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "broker_connections_user_id_broker_client_code_key" ON "broker_connections"("user_id", "broker", "client_code");

-- AddForeignKey
ALTER TABLE "broker_connections" ADD CONSTRAINT "broker_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
