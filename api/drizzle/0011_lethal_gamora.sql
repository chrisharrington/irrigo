CREATE TABLE "system_state" (
	"id" text PRIMARY KEY NOT NULL,
	"irrigation_enabled" boolean DEFAULT true NOT NULL,
	"since" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "system_state" ("id", "irrigation_enabled", "since") VALUES ('singleton', true, now()) ON CONFLICT ("id") DO NOTHING;
