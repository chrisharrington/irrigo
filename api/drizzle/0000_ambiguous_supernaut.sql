CREATE TABLE "grass_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"crop_coefficient" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grass_types_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sites_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "soil_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"available_water_holding_capacity_mm_per_m" real NOT NULL,
	"infiltration_rate_mm_per_hr" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "soil_types_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"site_id" uuid NOT NULL,
	"name" text NOT NULL,
	"grass_type_id" uuid NOT NULL,
	"soil_type_id" uuid NOT NULL,
	"root_depth_m" real NOT NULL,
	"allowable_depletion_fraction" real NOT NULL,
	"irrigation_efficiency" real NOT NULL,
	"flow_rate_l_per_min" real NOT NULL,
	"area_m2" real NOT NULL,
	"precipitation_rate_mm_per_hr" real,
	"current_depletion_mm" real DEFAULT 0 NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"home_assistant_entity_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zones_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "zones" ADD CONSTRAINT "zones_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zones" ADD CONSTRAINT "zones_grass_type_id_grass_types_id_fk" FOREIGN KEY ("grass_type_id") REFERENCES "public"."grass_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zones" ADD CONSTRAINT "zones_soil_type_id_soil_types_id_fk" FOREIGN KEY ("soil_type_id") REFERENCES "public"."soil_types"("id") ON DELETE no action ON UPDATE no action;