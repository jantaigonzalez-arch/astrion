-- EL DOCUMENTO QUE VE EL CLIENTE TAMBIÉN TIENE DUEÑO.
--
-- El reporte de servicio —el que se imprime, se firma y se le entrega al
-- laboratorio— tenía a Evoelution ESCRITA A MANO de arriba abajo: el logo era
-- un `<svg>` dentro del componente, el nombre y el lema eran texto literal, y
-- el pie llevaba su calle, su teléfono y su correo.
--
-- En un producto de una sola empresa eso pasa por detalle de maquetación. En
-- uno multiempresa es otra cosa: cualquier otro inquilino que imprimiera un
-- reporte le entregaba a SU cliente un documento firmado con la marca y los
-- datos de contacto de Evoelution. Es exactamente el mismo error que ya se
-- corrigió una capa más abajo con el logo de la barra lateral y con el prefijo
-- de folio, que nació clavado como «EVO-».
--
-- ---------------------------------------------------------------------------
-- UN LOGO APARTE, Y NO POR CAPRICHO
--
-- `logo_url` —el de la marca— vive en la barra lateral: fondo oscuro, poco
-- espacio, casi siempre cuadrado o un monograma. El del documento va impreso
-- sobre papel blanco. El mismo archivo rara vez sirve para los dos: el que se
-- ve bien en la barra sale invisible o pixelado en el papel, y al revés.
-- Obligar a que sea uno solo es obligar a elegir cuál de los dos se ve mal.
--
-- `document_logo_url` NULO no es un hueco: significa «usa el de la marca». La
-- cascada es logo de documento → logo de marca → monograma con la inicial, así
-- que una empresa a la que le sirva el mismo archivo no tiene que hacer nada.
--
-- ---------------------------------------------------------------------------
-- LO QUE FALTA SE OMITE, NO SE HEREDA
--
-- Los tres campos del pie son nulables y, cuando faltan, la línea sencillamente
-- NO SE IMPRIME. No se hereda de otra empresa ni se rellena con un valor por
-- omisión, porque imprimir la dirección de otro es justo el fallo que esto
-- viene a arreglar — y una línea de menos se nota al mirar el documento,
-- mientras que una línea ajena pasa desapercibida hasta que la lee el cliente.
--
-- `contact_email` NO es `mail_from`. Aquel es por dónde SALEN los avisos —una
-- cuenta técnica, a veces `no-reply@`— y este es a dónde escribe quien tiene el
-- reporte en la mano. Confundirlos manda las respuestas a un buzón que nadie
-- abre, que es una forma silenciosa de perder trabajo.
--
-- ---------------------------------------------------------------------------
-- ESCRITA A MANO, Y AQUÍ ESTÁ LA TRAMPA QUE COSTÓ ENCONTRAR
--
-- `drizzle-kit generate` NO se puede usar en este directorio, aunque
-- `AGENTS.md` solo lo advierta de las de inquilino. Los snapshots de
-- `drizzle/meta/` saltan del 0022 al 0029: las migraciones 0023 a 0028 se
-- escribieron a mano sin actualizar el snapshot, así que `generate` compara
-- contra un esquema de hace seis migraciones y produce una que las REHACE
-- TODAS — `CREATE TABLE platform_users`, `DROP COLUMN platform_role`, las
-- columnas de SMTP otra vez.
--
-- Eso no falla suave: el contenedor `migrate` aborta con «ya existe», y como
-- `web` solo arranca con `service_completed_successfully`, el sitio no vuelve a
-- levantar. Se generó, se leyó y se descartó antes de llegar a ningún lado.

ALTER TABLE "tenants" ADD COLUMN "document_logo_url" text;--> statement-breakpoint

ALTER TABLE "tenants" ADD COLUMN "tagline" varchar(120);--> statement-breakpoint

ALTER TABLE "tenants" ADD COLUMN "contact_address" varchar(200);--> statement-breakpoint

ALTER TABLE "tenants" ADD COLUMN "contact_phone" varchar(40);--> statement-breakpoint

ALTER TABLE "tenants" ADD COLUMN "contact_email" varchar(160);
