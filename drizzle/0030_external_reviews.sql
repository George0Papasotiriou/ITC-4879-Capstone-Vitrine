CREATE TABLE "external_review_summaries" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"count" integer NOT NULL,
	"rating_sum" integer NOT NULL,
	"runs_small" integer DEFAULT 0 NOT NULL,
	"true_to_size" integer DEFAULT 0 NOT NULL,
	"runs_large" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"position" integer NOT NULL,
	"rating" integer NOT NULL,
	"title" text,
	"body" text NOT NULL,
	"reviewed_on" date NOT NULL,
	"helpful" integer DEFAULT 0 NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"hidden_at" timestamp with time zone,
	"hidden_by" uuid,
	"hidden_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_reviews_rating_range" CHECK ("external_reviews"."rating" BETWEEN 1 AND 5)
);
--> statement-breakpoint
ALTER TABLE "external_review_summaries" ADD CONSTRAINT "external_review_summaries_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_reviews" ADD CONSTRAINT "external_reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_reviews" ADD CONSTRAINT "external_reviews_hidden_by_users_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_reviews_key" ON "external_reviews" USING btree ("product_id","source","external_id");--> statement-breakpoint
CREATE INDEX "external_reviews_product_idx" ON "external_reviews" USING btree ("product_id","position");