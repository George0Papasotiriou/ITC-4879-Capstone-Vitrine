CREATE TABLE "study_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"participant" text NOT NULL,
	"task" text NOT NULL,
	"event" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "study_events_participant_idx" ON "study_events" USING btree ("participant","occurred_at");