-- La empresa avisa desde SU PROPIO BUZÓN.
--
-- La 0024 dejó preparado el camino del dominio verificado: cada cliente publica
-- registros DKIM y el proveedor firma por él. Funciona, y tiene un coste que se
-- paga en soporte para siempre — cada alta es una conversación sobre DNS con
-- alguien que no sabe qué es un DNS.
--
-- Esto es la otra vía, y para una empresa pequeña es mejor: escribe el correo y
-- la contraseña de un buzón que YA tiene. El correo sale de su servidor, lo
-- firma su proveedor —así que SPF y DKIM ya están bien sin tocar nada—, le queda
-- en Enviados, y no cuesta ni un peso de servicio de envío.
--
-- ---------------------------------------------------------------------------
-- LA CONTRASEÑA VA CIFRADA, Y NO ES UN DETALLE
--
-- `smtp_password` guarda un secreto que abre el BUZÓN ENTERO de un cliente:
-- leer su correo, escribir en su nombre. Es el dato más peligroso de esta base,
-- más que cualquier ticket o contrato.
--
-- Se cifra con AES-256-GCM y una clave que NO vive aquí (ver `lib/secretos`):
-- quien se lleve un volcado de Postgres se lleva ruido. Por eso la columna es
-- `text` y no algo más corto — lo que se guarda es el sobre sellado, no la
-- contraseña.
--
-- GCM y no CBC porque además de cifrar AUTENTICA: cambiar un byte en la base
-- hace que el descifrado falle, en vez de devolver basura que acabaría
-- enviándose como contraseña a un servidor ajeno.
--
-- `smtp_checked_at` es cuándo funcionó una prueba de envío de verdad. Nulo
-- significa «configurado pero nunca comprobado», que es distinto de «no
-- configurado» y hay que poder distinguirlo: casi todos los fallos de esto son
-- una contraseña que el proveedor ya no acepta.
-- ---------------------------------------------------------------------------

ALTER TABLE "tenants" ADD COLUMN "smtp_host" varchar(255);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "smtp_port" integer;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "smtp_user" varchar(255);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "smtp_password" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "smtp_checked_at" timestamp with time zone;
