-- Foundation migration.
--
-- PostgreSQL is the single source of truth for Vitrine: relational data,
-- full-text search, fuzzy matching and vector similarity all live here, so
-- hybrid search (docs/PLAN.md 2.6 A1) is one query rather than a fan-out to a
-- separate search service.
--
-- vector    - pgvector, HNSW indexes over product text and image embeddings
-- pg_trgm   - trigram similarity for typo tolerance and Greeklish candidates
-- unaccent  - accent folding, required because Greek is searched with and
--             without accents and the final sigma folds to sigma

CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"description" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
