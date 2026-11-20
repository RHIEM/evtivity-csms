-- The accounting reference of a driver (Debitorennummer): the number the finance
-- department assigns, used in the Sage export of the driver's invoices and credit
-- notes. Not printed on the documents and not shown to the driver. Not unique.
-- Idempotent.
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "debtor_number" varchar(20);
