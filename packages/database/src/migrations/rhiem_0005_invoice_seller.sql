-- The seller of an invoice or credit note as it was at issue (company name,
-- address and invoice seller settings), never updated. Null on documents
-- issued before: their PDF prints the current company settings as before.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "seller" jsonb;
