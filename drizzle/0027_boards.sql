CREATE TABLE "board_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"board_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"note" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_items_quantity" CHECK ("board_items"."quantity" BETWEEN 1 AND 20),
	CONSTRAINT "board_items_note_length" CHECK ("board_items"."note" IS NULL OR char_length("board_items"."note") <= 200)
);
--> statement-breakpoint
CREATE TABLE "boards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_key" text NOT NULL,
	"title" text NOT NULL,
	"room_name" text,
	"room_wall_cm" integer,
	"link_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boards_title_length" CHECK (char_length("boards"."title") BETWEEN 1 AND 80)
);
--> statement-breakpoint
ALTER TABLE "board_items" ADD CONSTRAINT "board_items_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_items" ADD CONSTRAINT "board_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "board_items_piece" ON "board_items" USING btree ("board_id","product_id");--> statement-breakpoint
CREATE INDEX "board_items_board_idx" ON "board_items" USING btree ("board_id","position");--> statement-breakpoint
CREATE INDEX "boards_owner_idx" ON "boards" USING btree ("owner_key","updated_at");