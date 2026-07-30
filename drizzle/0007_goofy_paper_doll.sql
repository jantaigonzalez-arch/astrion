CREATE TABLE "ticket_comment_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"part_id" uuid,
	"part_number" varchar(80) NOT NULL,
	"description" varchar(300) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_cost_mxn" numeric(12, 2),
	"unit_cost_usd" numeric(12, 2)
);
--> statement-breakpoint
CREATE TABLE "spare_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_number" varchar(80) NOT NULL,
	"description" varchar(300) NOT NULL,
	"brand" varchar(80),
	"cost_mxn" numeric(12, 2),
	"cost_usd" numeric(12, 2),
	"stock" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spare_parts_part_number_unique" UNIQUE("part_number")
);
--> statement-breakpoint
ALTER TABLE "ticket_comment_parts" ADD CONSTRAINT "ticket_comment_parts_comment_id_ticket_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."ticket_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_comment_parts" ADD CONSTRAINT "ticket_comment_parts_part_id_spare_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."spare_parts"("id") ON DELETE set null ON UPDATE no action;