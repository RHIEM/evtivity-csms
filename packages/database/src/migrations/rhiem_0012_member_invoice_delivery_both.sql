-- Member invoices can be emailed to the driver and to the fleet's billing
-- contacts (member_invoice_delivery 'driver_and_contacts'). Automatic
-- invoicing then needs a billing contact, as with 'billing_contacts'.
-- Idempotent.
ALTER TABLE "fleets" DROP CONSTRAINT IF EXISTS "fleets_member_invoice_delivery_check";--> statement-breakpoint
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_member_invoice_delivery_check"
  CHECK ("member_invoice_delivery" IN ('driver', 'billing_contacts', 'driver_and_contacts', 'none'));--> statement-breakpoint
ALTER TABLE "fleets" DROP CONSTRAINT IF EXISTS "fleets_auto_invoice_contact_check";--> statement-breakpoint
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_auto_invoice_contact_check"
  CHECK (NOT "auto_invoice" OR cardinality("billing_contact_emails") > 0
    OR ("account_invoice_recipient" = 'member'
      AND "member_invoice_delivery" NOT IN ('billing_contacts', 'driver_and_contacts')));
