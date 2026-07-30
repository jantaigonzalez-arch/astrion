CREATE TABLE "equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"brand" varchar(80) NOT NULL,
	"name" varchar(200) NOT NULL,
	"model" varchar(160),
	"photo" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"equipment_id" uuid NOT NULL,
	"brand" varchar(80) NOT NULL,
	"name" varchar(200) NOT NULL,
	"serial_number" varchar(120),
	"photo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_submodules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"serial_number" varchar(120),
	"photo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_modules" ADD CONSTRAINT "equipment_modules_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_submodules" ADD CONSTRAINT "equipment_submodules_module_id_equipment_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."equipment_modules"("id") ON DELETE cascade ON UPDATE no action;