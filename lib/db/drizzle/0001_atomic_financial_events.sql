CREATE TABLE IF NOT EXISTS "financial_idempotency" (
	"scope" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"response_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "financial_idempotency_scope_key_pk" PRIMARY KEY("scope","idempotency_key")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_idempotency_created_at_idx" ON "financial_idempotency" USING btree ("created_at");
--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "exchange_rate" double precision DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "amount_usd" double precision;
--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "amount_cdf" double precision;
--> statement-breakpoint
WITH rate AS (
	SELECT COALESCE(
		(SELECT NULLIF("usd_to_cdf_rate", 0) FROM "settings" ORDER BY "id" LIMIT 1),
		2800
	) AS r
)
UPDATE "supplier_payments"
SET
	"exchange_rate" = (SELECT r FROM rate),
	"amount_usd" = CASE
		WHEN "currency" = 'USD' THEN "amount"
		ELSE "amount" / (SELECT r FROM rate)
	END,
	"amount_cdf" = CASE
		WHEN "currency" = 'CDF' THEN "amount"
		ELSE "amount" * (SELECT r FROM rate)
	END
WHERE "amount_usd" IS NULL
   OR "amount_cdf" IS NULL
   OR "exchange_rate" <= 1;
