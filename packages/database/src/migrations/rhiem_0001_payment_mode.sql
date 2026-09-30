-- Invoice payment mode. Fleets set it for all their drivers, a driver value
-- overrides the fleet, and charging_sessions keeps the mode resolved at
-- session start. All columns are nullable so existing rows keep the
-- card-based flow.
CREATE TYPE "public"."payment_mode" AS ENUM('card', 'invoice');--> statement-breakpoint
ALTER TABLE "fleets" ADD COLUMN "payment_mode" "payment_mode";--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "payment_mode" "payment_mode";--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD COLUMN "payment_mode" "payment_mode";
