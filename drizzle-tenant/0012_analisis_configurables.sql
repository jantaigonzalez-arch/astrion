CREATE TABLE "analysis_placements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis" varchar(60) NOT NULL,
	"screen" varchar(120) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"source" varchar(20) DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_placements_unique" ON "analysis_placements" USING btree ("analysis","screen");--> statement-breakpoint
CREATE INDEX "analysis_placements_screen_idx" ON "analysis_placements" USING btree ("screen","position");