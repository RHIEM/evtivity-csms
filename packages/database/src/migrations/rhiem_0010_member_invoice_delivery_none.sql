-- Member invoices can be kept in the CSMS without being emailed
-- (member_invoice_delivery 'none'). Automatic invoicing needs a billing
-- contact only where the contacts receive the invoices: the fleet invoice,
-- or member invoices delivered to the contacts. Idempotent.
ALTER TABLE "fleets" DROP CONSTRAINT IF EXISTS "fleets_member_invoice_delivery_check";--> statement-breakpoint
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_member_invoice_delivery_check"
  CHECK ("member_invoice_delivery" IN ('driver', 'billing_contacts', 'none'));--> statement-breakpoint
ALTER TABLE "fleets" DROP CONSTRAINT IF EXISTS "fleets_auto_invoice_contact_check";--> statement-breakpoint
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_auto_invoice_contact_check"
  CHECK (NOT "auto_invoice" OR cardinality("billing_contact_emails") > 0
    OR ("account_invoice_recipient" = 'member' AND "member_invoice_delivery" <> 'billing_contacts'));
