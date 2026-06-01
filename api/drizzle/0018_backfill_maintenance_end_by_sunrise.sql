UPDATE "schedules" SET "end_by_sunrise" = TRUE WHERE "slug" = 'maintenance' AND "end_by_sunrise" IS NULL;
