CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class" text NOT NULL,
	"tone" text NOT NULL,
	"title" text NOT NULL,
	"sub" text,
	"when_at" timestamp with time zone DEFAULT now() NOT NULL,
	"zone_id" uuid,
	"ack" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alerts_class_check" CHECK ("alerts"."class" in ('weather-stale', 'ha-call-failed', 'missed-close')),
	CONSTRAINT "alerts_tone_check" CHECK ("alerts"."tone" in ('warn', 'danger'))
);
--> statement-breakpoint
CREATE TABLE "weather_state" (
	"id" text PRIMARY KEY NOT NULL,
	"last_successful_fetch_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE no action ON UPDATE no action;