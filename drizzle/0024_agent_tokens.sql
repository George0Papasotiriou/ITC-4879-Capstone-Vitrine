CREATE TABLE "agent_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"hint" text NOT NULL,
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "agent_tokens_scopes_known" CHECK ("agent_tokens"."scopes" <@ ARRAY['cart', 'orders']::text[] AND cardinality("agent_tokens"."scopes") > 0),
	CONSTRAINT "agent_tokens_name_length" CHECK (char_length("agent_tokens"."name") BETWEEN 1 AND 60)
);
--> statement-breakpoint
ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_tokens_hash_key" ON "agent_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "agent_tokens_user_idx" ON "agent_tokens" USING btree ("user_id","created_at");