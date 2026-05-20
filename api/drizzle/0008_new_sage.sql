ALTER TABLE "zones" ADD COLUMN "patch" text DEFAULT 'a' NOT NULL;--> statement-breakpoint
ALTER TABLE "zones" ADD CONSTRAINT "zones_patch_check" CHECK ("zones"."patch" in ('a', 'b', 'c'));