-- How a fleet's account invoices are settled: 'payment' (the default, paid by
-- transfer, with due date and overdue notice) or 'external' (settled outside
-- EVtivity, e.g. deducted from the payroll: issued as paid, the settlement
-- note printed instead of the payment block). The invoice keeps the note it
-- was issued with. Idempotent.
ALTER TABLE "fleets" ADD COLUMN IF NOT EXISTS "account_settlement" varchar(16) DEFAULT 'payment' NOT NULL;--> statement-breakpoint
ALTER TABLE "fleets" ADD COLUMN IF NOT EXISTS "settlement_note" varchar(500);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "fleets" ADD CONSTRAINT "fleets_account_settlement_check"
    CHECK ("account_settlement" IN ('payment', 'external'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "settlement_note" varchar(500);
