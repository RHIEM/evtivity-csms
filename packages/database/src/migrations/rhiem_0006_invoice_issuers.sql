-- Invoice issuers: a seller other than the company that a fleet's invoices
-- are issued under, with its own number range per document kind. The fleet
-- names its issuer (null: the company), an invoice and its credit note keep
-- the issuer they were issued under. invoice_issuer_number_counters numbers
-- the documents of an issuer without gaps (one row per issuer, kind and year;
-- year 0 for a range without year). Idempotent.
CREATE TABLE IF NOT EXISTS "invoice_issuers" (
  "id" text PRIMARY KEY NOT NULL,
  "name" varchar(255) NOT NULL,
  "street" varchar(255),
  "zip" varchar(20),
  "city" varchar(100),
  "state" varchar(100),
  "country" varchar(100),
  "tax_id" varchar(64),
  "tax_id_label" varchar(40),
  "registration_number" varchar(100),
  "email" varchar(254),
  "phone" varchar(40),
  "invoice_prefix" varchar(20) DEFAULT '' NOT NULL,
  "invoice_with_year" boolean DEFAULT false NOT NULL,
  "invoice_start" integer DEFAULT 1 NOT NULL,
  "invoice_digits" smallint DEFAULT 0 NOT NULL,
  "credit_note_prefix" varchar(20) DEFAULT '' NOT NULL,
  "credit_note_with_year" boolean DEFAULT false NOT NULL,
  "credit_note_start" integer DEFAULT 1 NOT NULL,
  "credit_note_digits" smallint DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "invoice_issuers_number_check" CHECK ("invoice_start" BETWEEN 0 AND 999999999 AND "credit_note_start" BETWEEN 0 AND 999999999 AND "invoice_digits" BETWEEN 0 AND 10 AND "credit_note_digits" BETWEEN 0 AND 10)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_issuer_number_counters" (
  "issuer_id" text NOT NULL,
  "kind" varchar(16) NOT NULL,
  "year" smallint NOT NULL,
  "value" bigint NOT NULL,
  CONSTRAINT "invoice_issuer_number_counters_issuer_id_kind_year_pk" PRIMARY KEY ("issuer_id", "kind", "year")
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "invoice_issuer_number_counters" ADD CONSTRAINT "invoice_issuer_number_counters_issuer_id_invoice_issuers_id_fk"
    FOREIGN KEY ("issuer_id") REFERENCES "invoice_issuers"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "fleets" ADD COLUMN IF NOT EXISTS "invoice_issuer_id" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "fleets" ADD CONSTRAINT "fleets_invoice_issuer_id_invoice_issuers_id_fk"
    FOREIGN KEY ("invoice_issuer_id") REFERENCES "invoice_issuers"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "issuer_id" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issuer_id_invoice_issuers_id_fk"
    FOREIGN KEY ("issuer_id") REFERENCES "invoice_issuers"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_invoices_issuer_id" ON "invoices" ("issuer_id") WHERE issuer_id IS NOT NULL;
