<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Este proyecto está EN PRODUCCIÓN, con clientes dentro

Hay dos entornos y uno de ellos tiene datos reales: 161 organizaciones con su
RFC, importes de contratos, 633 tickets. Antes de correr cualquier cosa,
sabé contra cuál estás.

**Cómo distinguirlos:** si el comando lleva `ssh astrion-srv` o `docker
compose`, es **producción**. Si no —`npm run dev`, `psql localhost`,
`npx tsx scripts/…`—, es tu máquina.

Las dos bases se llaman `evoelution` y el rol de las dos es `evoelution`. El
nombre no distingue nada; lo que distingue es el host.

## Reglas

1. **Trabajá en local por defecto.** Producción se toca cuando el usuario lo
   pide, no cuando parece práctico.
2. **En producción, leer es libre; escribir se avisa.** Diagnosticar
   (`docker ps`, `logs`, un `select`) no necesita permiso. Reconstruir,
   desplegar, migrar, importar, borrar o reiniciar, sí: proponelo y esperá.
3. **Nunca edites archivos en el servidor.** Ni `vim`, ni `sed -i`, ni un
   `cat >`. Todo cambio va por GitHub y baja con `git pull` — el servidor
   tiene su llave de solo lectura. Un parche en vivo deja un árbol que nadie
   puede reproducir y hace chocar el siguiente pull (pasó el 2026-08-24).
4. **Ninguna migración ni importación llega a producción sin haber corrido
   antes contra una copia sincronizada.** `npm run sync:prod` trae producción
   a local y aplica encima las migraciones pendientes: es el mismo ensayo que
   hará el servidor. Las de inquilino (`drizzle-tenant/`) se escriben **a
   mano**: `drizzle-kit generate` con esa configuración produce una migración
   rota — ver el comentario en `drizzle.tenant.config.ts`.
5. **`--wipe`, `drop`, `delete` y `--force` no se corren en producción de
   primera intención.** Proponelos con lo que borran a la vista.
6. **La sincronización va en un solo sentido: prod → local.** No existe la
   inversa y no se escribe una.
7. **Desplegá con `npm run deploy:prod`**, no a mano. Comprueba que el árbol
   esté limpio, que el HEAD esté en origin y avisa si el despliegue incluye
   migraciones. `--solo-migrate` reconstruye únicamente la imagen de scripts,
   sin tirar el sitio.
8. **La base local es una copia de producción con clientes reales.** No pegues
   nombres, RFC ni importes en commits, reportes o mensajes; los volcados
   viven en `.sync/`, que está ignorado, y ahí se quedan.
9. **Un importador que no reconoce algo tiene que decirlo.** Degradar en
   silencio (`?? null`, `?? new Date()`) ya metió 633 tickets sin técnico y
   estuvo a punto de aplastar dos años de fechas contra el día de la carga.
   Si un valor del origen no casa, dejá incidencia en el reporte.

El detalle completo —qué desarma la sincronización y por qué, cómo ensayar una
carga, qué hacer si un despliegue sale mal— está en
[`docs/ENTORNOS.md`](docs/ENTORNOS.md). El runbook del servidor, en
[`docs/DEPLOY.md`](docs/DEPLOY.md).
