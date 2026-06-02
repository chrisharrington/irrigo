CREATE TABLE "notification_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_start" boolean DEFAULT true NOT NULL,
	"schedule_end" boolean DEFAULT true NOT NULL,
	"watering_start" boolean DEFAULT false NOT NULL,
	"watering_end" boolean DEFAULT false NOT NULL,
	"error" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "notification_settings" ("id", "schedule_start", "schedule_end", "watering_start", "watering_end", "error") VALUES ('singleton', true, true, false, false, true) ON CONFLICT ("id") DO NOTHING;
