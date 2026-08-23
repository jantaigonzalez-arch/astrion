-- Cada empresa avisa desde SU dominio.
--
-- El remitente es un dato del plano de control y no de los `settings` del
-- inquilino, por lo mismo que la marca: para mandar un correo hay que saber
-- desde dónde sale ANTES de abrir la conexión a su esquema, y a veces sin
-- petición ninguna.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ `mail_verified_at` Y NO UN BOOLEANO
--
-- Porque la pregunta que hay que poder responder no es «¿está verificado?»
-- sino «¿desde cuándo?». Un dominio puede dejar de verificar solo —el cliente
-- toca su DNS y borra el registro DKIM sin saber lo que hace— y entonces hay
-- que saber a partir de qué momento los correos empezaron a caer en spam.
--
-- Mientras sea nulo, los avisos de esa empresa salen por el remitente de la
-- plataforma. Enviar desde un dominio a medio verificar no es «casi funciona»:
-- es correo que acaba en spam y que quema la reputación de todo lo demás que
-- se manda desde la misma infraestructura.
-- ---------------------------------------------------------------------------

ALTER TABLE "tenants" ADD COLUMN "mail_domain" varchar(255);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "mail_from" varchar(255);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "mail_from_name" varchar(120);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "mail_reply_to" varchar(255);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "mail_verified_at" timestamp with time zone;
