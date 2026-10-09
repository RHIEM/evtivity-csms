-- Carries the fork's invoice payment mode (rhiem_0001) over to the fleet
-- account billing of EVtivity v0.1.41 and drops it. A fleet in invoice mode
-- gets account billing, a member with the driver override 'card' is opted
-- out, and an unbilled session started in invoice mode is billed to the
-- driver's oldest invoice fleet (same rule as the old resolution). A driver
-- override 'invoice' outside an invoice fleet has no counterpart upstream: it
-- is reported with a notice, and its sessions stay unstamped. Runs once (the
-- columns are gone afterwards); on a new database it finds no rows.

UPDATE "fleets" SET "account_billing_enabled" = true, "updated_at" = now()
WHERE "payment_mode" = 'invoice' AND NOT "account_billing_enabled";--> statement-breakpoint
UPDATE "fleet_drivers" fd SET "account_billing_opt_out" = true
FROM "fleets" f, "drivers" d
WHERE f."id" = fd."fleet_id" AND d."id" = fd."driver_id"
  AND f."payment_mode" = 'invoice' AND d."payment_mode" = 'card'
  AND NOT fd."account_billing_opt_out";--> statement-breakpoint
UPDATE "charging_sessions" cs SET "billing_mode" = 'account', "billing_fleet_id" = target."fleet_id"
FROM (
  SELECT DISTINCT ON (fd."driver_id") fd."driver_id", fd."fleet_id"
  FROM "fleet_drivers" fd
  JOIN "fleets" f ON f."id" = fd."fleet_id"
  WHERE f."payment_mode" = 'invoice'
  ORDER BY fd."driver_id", fd."created_at", fd."id"
) target
WHERE cs."driver_id" = target."driver_id"
  AND cs."payment_mode" = 'invoice'
  AND cs."billing_mode" IS NULL
  AND cs."invoice_id" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "payment_records" pr WHERE pr."session_id" = cs."id");--> statement-breakpoint
DO $$
DECLARE
  unmapped text;
BEGIN
  SELECT string_agg(d."id", ', ' ORDER BY d."id") INTO unmapped
  FROM "drivers" d
  WHERE d."payment_mode" = 'invoice'
    AND NOT EXISTS (
      SELECT 1 FROM "fleet_drivers" fd JOIN "fleets" f ON f."id" = fd."fleet_id"
      WHERE fd."driver_id" = d."id" AND f."payment_mode" = 'invoice'
    );
  IF unmapped IS NOT NULL THEN
    RAISE NOTICE 'rhiem_0003: drivers in invoice mode without an invoice fleet, add them to an account billing fleet: %', unmapped;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "charging_sessions" DROP COLUMN IF EXISTS "payment_mode";--> statement-breakpoint
ALTER TABLE "drivers" DROP COLUMN IF EXISTS "payment_mode";--> statement-breakpoint
ALTER TABLE "fleets" DROP COLUMN IF EXISTS "payment_mode";--> statement-breakpoint
DROP TYPE IF EXISTS "payment_mode";
