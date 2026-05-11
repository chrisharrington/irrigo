ALTER TABLE "schedules" ADD COLUMN "allowed_days" integer[];--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "allowed_time_windows" jsonb;