CREATE TABLE "product_models" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"storage_key" text,
	"bytes" integer,
	"triangles" integer,
	"fit" double precision,
	"cost_micros" integer,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_models_origin" CHECK ("product_models"."origin" IN ('made', 'ai')),
	CONSTRAINT "product_models_status" CHECK ("product_models"."status" IN ('queued', 'running', 'ready', 'rejected', 'hidden', 'failed')),
	CONSTRAINT "product_models_fit" CHECK ("product_models"."fit" IS NULL OR ("product_models"."fit" >= 0 AND "product_models"."fit" <= 1)),
	CONSTRAINT "product_models_ready_has_file" CHECK ("product_models"."status" <> 'ready' OR "product_models"."storage_key" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "product_models" ADD CONSTRAINT "product_models_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_models_piece" ON "product_models" USING btree ("product_id","origin");--> statement-breakpoint
CREATE INDEX "product_models_status_idx" ON "product_models" USING btree ("origin","status");