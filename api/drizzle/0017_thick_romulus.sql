CREATE TABLE "scheduling_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" uuid NOT NULL,
	"schedule_id" uuid,
	"date" date NOT NULL,
	"replan_at" timestamp with time zone NOT NULL,
	"outcome" text NOT NULL,
	"reason" text NOT NULL,
	"depletion_before_mm" real NOT NULL,
	"depletion_after_mm" real NOT NULL,
	"trigger_threshold_mm" real NOT NULL,
	"weather_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduling_decisions" ADD CONSTRAINT "scheduling_decisions_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_decisions" ADD CONSTRAINT "scheduling_decisions_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_decisions" ADD CONSTRAINT "scheduling_decisions_weather_snapshot_id_weather_snapshots_id_fk" FOREIGN KEY ("weather_snapshot_id") REFERENCES "public"."weather_snapshots"("id") ON DELETE set null ON UPDATE no action;