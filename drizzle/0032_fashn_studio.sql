CREATE TABLE "model_shots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"preset" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"storage_key" text,
	"failure_reason" text,
	"cost_micros" integer,
	"requested_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "try_ons" ADD COLUMN "outfit_id" uuid;--> statement-breakpoint
ALTER TABLE "try_ons" ADD COLUMN "outfit_position" integer;--> statement-breakpoint
ALTER TABLE "try_ons" ADD COLUMN "video_status" text;--> statement-breakpoint
ALTER TABLE "try_ons" ADD COLUMN "video_key" text;--> statement-breakpoint
ALTER TABLE "try_ons" ADD COLUMN "video_failure" text;--> statement-breakpoint
ALTER TABLE "try_ons" ADD COLUMN "video_cost_micros" integer;--> statement-breakpoint
ALTER TABLE "model_shots" ADD CONSTRAINT "model_shots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "model_shots_product_preset_key" ON "model_shots" USING btree ("product_id","preset");--> statement-breakpoint
CREATE INDEX "try_ons_outfit_idx" ON "try_ons" USING btree ("outfit_id","outfit_position");