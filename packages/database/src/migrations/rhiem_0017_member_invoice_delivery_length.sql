-- The delivery 'driver_and_contacts' (rhiem_0012) is 19 characters, but the
-- column of rhiem_0008 holds 16: saving it failed with "value too long for type
-- character varying(16)". Widen the column; the check constraints stay as they are.
-- Idempotent.
ALTER TABLE "fleets" ALTER COLUMN "member_invoice_delivery" TYPE varchar(32);
