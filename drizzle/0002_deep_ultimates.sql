ALTER TABLE "tickets" ADD COLUMN "equipment_id" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "module_id" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_module_id_equipment_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."equipment_modules"("id") ON DELETE set null ON UPDATE no action;