CREATE TABLE "pictures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"product_id" uuid NOT NULL,
	"style" text,
	"upload_id" uuid,
	"actor_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"result_key" text,
	"failure_reason" text,
	"cost_micros" integer,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pictures_kind" CHECK ("pictures"."kind" IN ('room', 'quick', 'scene')),
	CONSTRAINT "pictures_status" CHECK ("pictures"."status" IN ('queued', 'running', 'done', 'failed')),
	CONSTRAINT "pictures_scene_has_style" CHECK (("pictures"."kind" = 'scene') = ("pictures"."style" IS NOT NULL)),
	CONSTRAINT "pictures_own_room_has_photo" CHECK (("pictures"."kind" = 'scene') = ("pictures"."upload_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "pictures" ADD CONSTRAINT "pictures_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pictures" ADD CONSTRAINT "pictures_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pictures_actor_idx" ON "pictures" USING btree ("actor_key","created_at");--> statement-breakpoint
CREATE INDEX "pictures_upload_idx" ON "pictures" USING btree ("upload_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pictures_scene_key" ON "pictures" USING btree ("product_id","style") WHERE "pictures"."kind" = 'scene' AND "pictures"."status" <> 'failed';