CREATE TABLE "search_judgments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"query" text NOT NULL,
	"locale" text NOT NULL,
	"product_id" uuid NOT NULL,
	"grade" integer NOT NULL,
	"judged_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_judgments_grade_range" CHECK ("search_judgments"."grade" BETWEEN 0 AND 3)
);
--> statement-breakpoint
ALTER TABLE "search_judgments" ADD CONSTRAINT "search_judgments_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_judgments" ADD CONSTRAINT "search_judgments_judged_by_users_id_fk" FOREIGN KEY ("judged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "search_judgments_query_product_key" ON "search_judgments" USING btree ("query","locale","product_id");