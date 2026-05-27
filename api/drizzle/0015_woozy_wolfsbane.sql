ALTER TABLE "alerts" DROP CONSTRAINT "alerts_class_check";--> statement-breakpoint
ALTER TABLE "zones" ADD COLUMN "current_depletion_reconciled_at" timestamp with time zone;--> statement-breakpoint
UPDATE "zones" SET "current_depletion_reconciled_at" = now() WHERE "current_depletion_reconciled_at" IS NULL;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_class_check" CHECK ("alerts"."class" in ('weather-stale', 'ha-call-failed', 'missed-close', 'actuation-stale'));
