-- Who a fleet's member invoices and their credit notes are emailed to:
-- 'driver' (the default, the member) or 'billing_contacts' (the fleet's
-- billing contacts, e.g. a payroll office that forwards them). Idempotent.
ALTER TABLE "fleets" ADD COLUMN IF NOT EXISTS "member_invoice_delivery" varchar(16) DEFAULT 'driver' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "fleets" ADD CONSTRAINT "fleets_member_invoice_delivery_check"
    CHECK ("member_invoice_delivery" IN ('driver', 'billing_contacts'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
