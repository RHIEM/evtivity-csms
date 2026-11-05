-- PDF letterhead of an invoice issuer: an issuer keeps its own versions
-- (pdf_letterheads.issuer_id; NULL is a version of the company) and names the
-- current one (invoice_issuers.letterhead_id; NULL takes the company's,
-- pdf.letterhead). Its invoices and credit notes keep the version current at
-- their issue (invoices.letterhead_id). Idempotent.
ALTER TABLE "pdf_letterheads" ADD COLUMN IF NOT EXISTS "issuer_id" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "pdf_letterheads" ADD CONSTRAINT "pdf_letterheads_issuer_id_invoice_issuers_id_fk"
    FOREIGN KEY ("issuer_id") REFERENCES "invoice_issuers"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pdf_letterheads_issuer_id" ON "pdf_letterheads" ("issuer_id") WHERE issuer_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_issuers" ADD COLUMN IF NOT EXISTS "letterhead_id" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "invoice_issuers" ADD CONSTRAINT "invoice_issuers_letterhead_id_pdf_letterheads_id_fk"
    FOREIGN KEY ("letterhead_id") REFERENCES "pdf_letterheads"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
