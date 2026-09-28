CREATE TYPE "public"."concierge_event_kind" AS ENUM('turn', 'tool', 'refused');--> statement-breakpoint
CREATE TYPE "public"."reco_event_kind" AS ENUM('impression', 'click', 'add_to_cart');--> statement-breakpoint
CREATE TABLE "concierge_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "concierge_event_kind" NOT NULL,
	"surface" text NOT NULL,
	"tool" text,
	"outcome" text NOT NULL,
	"latency_ms" integer,
	"steps" integer,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concierge_events_latency_nonnegative" CHECK ("concierge_events"."latency_ms" IS NULL OR "concierge_events"."latency_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reco_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"shelf" text NOT NULL,
	"kind" "reco_event_kind" NOT NULL,
	"product_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reco_events" ADD CONSTRAINT "reco_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "concierge_events_occurred_idx" ON "concierge_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "reco_events_occurred_idx" ON "reco_events" USING btree ("occurred_at");