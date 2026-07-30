ALTER TABLE "ticket_comments" ADD COLUMN "equipment_id" uuid;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD COLUMN "module_id" uuid;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD COLUMN "submodule_id" uuid;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_module_id_equipment_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."equipment_modules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_submodule_id_equipment_submodules_id_fk" FOREIGN KEY ("submodule_id") REFERENCES "public"."equipment_submodules"("id") ON DELETE set null ON UPDATE no action;