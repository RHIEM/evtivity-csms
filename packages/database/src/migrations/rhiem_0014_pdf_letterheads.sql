-- PDF letterheads: versions of an A4 image drawn as the background of the
-- first page of an invoice or credit note, with the free areas in mm. A row
-- never changes; the pdf.letterhead setting names the current version ('' or
-- no row: none). An invoice keeps the version current at its issue
-- (invoices.letterhead_id), so a re-rendered PDF shows the letterhead it was
-- issued with. Idempotent.
CREATE TABLE IF NOT EXISTS "pdf_letterheads" (
  "id" text PRIMARY KEY NOT NULL,
  "name" varchar(100) NOT NULL,
  "image" text NOT NULL,
  "image_sha256" char(64) NOT NULL,
  "address_left_mm" numeric(5, 1) DEFAULT 25 NOT NULL,
  "address_top_mm" numeric(5, 1) DEFAULT 62.7 NOT NULL,
  "content_top_mm" numeric(5, 1) DEFAULT 105 NOT NULL,
  "content_bottom_mm" numeric(5, 1) DEFAULT 250 NOT NULL,
  "margin_left_mm" numeric(5, 1) DEFAULT 25 NOT NULL,
  "margin_right_mm" numeric(5, 1) DEFAULT 20 NOT NULL,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pdf_letterheads_layout_check" CHECK ("content_top_mm" < "content_bottom_mm" AND "content_bottom_mm" <= 297 AND "address_left_mm" >= 0 AND "address_top_mm" >= 0 AND "margin_left_mm" >= 0 AND "margin_right_mm" >= 0)
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "pdf_letterheads" ADD CONSTRAINT "pdf_letterheads_created_by_user_id_users_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "letterhead_id" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_letterhead_id_pdf_letterheads_id_fk"
    FOREIGN KEY ("letterhead_id") REFERENCES "pdf_letterheads"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_invoices_letterhead_id" ON "invoices" ("letterhead_id") WHERE letterhead_id IS NOT NULL;
