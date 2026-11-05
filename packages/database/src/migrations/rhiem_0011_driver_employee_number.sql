-- The operator's reference for a driver, e.g. a personnel number, printed on
-- the driver's invoices and credit notes when set. Not unique. Idempotent.
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "employee_number" varchar(50);
