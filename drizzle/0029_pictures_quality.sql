DROP INDEX "pictures_scene_key";--> statement-breakpoint
ALTER TABLE "pictures" ADD COLUMN "preview_key" text;--> statement-breakpoint
ALTER TABLE "pictures" ADD COLUMN "download_key" text;--> statement-breakpoint
ALTER TABLE "pictures" ADD COLUMN "quality" jsonb;--> statement-breakpoint
ALTER TABLE "pictures" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pictures" ADD COLUMN "prompt_version" text;--> statement-breakpoint
CREATE UNIQUE INDEX "pictures_scene_key" ON "pictures" USING btree ("product_id","style") WHERE "pictures"."kind" = 'scene' AND "pictures"."status" <> 'failed' AND "pictures"."provider" NOT IN ('drawn', 'fixture');