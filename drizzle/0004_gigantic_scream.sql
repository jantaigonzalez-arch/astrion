ALTER TYPE "public"."user_role" ADD VALUE 'sales';--> statement-breakpoint
CREATE TABLE "contract_equipment" (
	"contract_id" uuid NOT NULL,
	"equipment_id" uuid NOT NULL,
	CONSTRAINT "contract_equipment_contract_id_equipment_id_pk" PRIMARY KEY("contract_id","equipment_id")
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" varchar(60) NOT NULL,
	"client_id" uuid NOT NULL,
	"sales_rep_id" uuid,
	"amount_mxn" numeric(14, 2),
	"amount_usd" numeric(14, 2),
	"start_date" date,
	"end_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "contract_equipment" ADD CONSTRAINT "contract_equipment_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_equipment" ADD CONSTRAINT "contract_equipment_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_sales_rep_id_users_id_fk" FOREIGN KEY ("sales_rep_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;