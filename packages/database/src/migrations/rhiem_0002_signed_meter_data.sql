-- Signed meter data (e.g. OCMF) kept as billing evidence, and the public keys
-- of the meters that signed it. Neither table is part of log retention
-- pruning; foreign keys are set to null on delete so records survive the
-- removal of their station or session.
CREATE TABLE IF NOT EXISTS "signed_meter_values" (
	"id" serial PRIMARY KEY NOT NULL,
	"station_id" text,
	"evse_id" text,
	"session_id" text,
	"station_identity" varchar(255) NOT NULL,
	"transaction_id" varchar(36),
	"timestamp" timestamp with time zone NOT NULL,
	"measurand" varchar(100),
	"context" varchar(50),
	"encoding_method" varchar(50),
	"signing_method" varchar(50),
	"public_key" text,
	"signed_data" text NOT NULL,
	"signed_data_sha256" varchar(64) NOT NULL,
	"source" varchar(30),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "signed_meter_values" ADD CONSTRAINT "signed_meter_values_station_id_fk" FOREIGN KEY ("station_id") REFERENCES "charging_stations"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "signed_meter_values" ADD CONSTRAINT "signed_meter_values_evse_id_fk" FOREIGN KEY ("evse_id") REFERENCES "evses"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "signed_meter_values" ADD CONSTRAINT "signed_meter_values_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "charging_sessions"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_signed_meter_values_session_id" ON "signed_meter_values" ("session_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "signed_meter_values_dedup_idx" ON "signed_meter_values" ("station_identity","signed_data_sha256");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meter_public_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"station_id" text,
	"station_identity" varchar(255) NOT NULL,
	"connector_id" integer NOT NULL,
	"meter_serial" varchar(255),
	"key_type" varchar(50),
	"public_key" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "meter_public_keys" ADD CONSTRAINT "meter_public_keys_station_id_fk" FOREIGN KEY ("station_id") REFERENCES "charging_stations"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meter_public_keys_station_connector_key_idx" ON "meter_public_keys" ("station_identity","connector_id","public_key");
--> statement-breakpoint
ALTER TABLE "signed_meter_values" ADD COLUMN IF NOT EXISTS "meter_public_key_id" integer;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "signed_meter_values" ADD CONSTRAINT "signed_meter_values_meter_public_key_id_fk" FOREIGN KEY ("meter_public_key_id") REFERENCES "meter_public_keys"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;
