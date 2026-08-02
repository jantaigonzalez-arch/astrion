CREATE TYPE "public"."platform_role" AS ENUM('superadmin', 'support');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "platform_role" "platform_role";