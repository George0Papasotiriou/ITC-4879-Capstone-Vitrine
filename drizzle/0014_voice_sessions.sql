CREATE TABLE "voice_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_key" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"locale" text NOT NULL,
	"day" date NOT NULL,
	"reserved_minutes" integer NOT NULL,
	"usage_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"minted_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"used_seconds" integer,
	CONSTRAINT "voice_sessions_minutes_positive" CHECK ("voice_sessions"."reserved_minutes" > 0 AND ("voice_sessions"."used_seconds" IS NULL OR "voice_sessions"."used_seconds" >= 0))
);
--> statement-breakpoint
CREATE INDEX "voice_sessions_actor_idx" ON "voice_sessions" USING btree ("actor_key","created_at");