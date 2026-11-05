-- PDF branding of an invoice issuer: its own logo (a PNG, JPEG or SVG data
-- URI like the pdf.logo setting) and footer drawn on its invoices and credit
-- notes. NULL takes the company's (pdf.logo, pdf.footer); an empty footer
-- draws no footer. Idempotent.
ALTER TABLE "invoice_issuers" ADD COLUMN IF NOT EXISTS "pdf_logo" text;--> statement-breakpoint
ALTER TABLE "invoice_issuers" ADD COLUMN IF NOT EXISTS "pdf_footer" text;
