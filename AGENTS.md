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
   hará el servidor. **Las DOS carpetas de migraciones se escriben a mano** y
   `drizzle-kit generate` no sirve en ninguna de las dos:
   - `drizzle-tenant/` — ver el comentario en `drizzle.tenant.config.ts`.
   - `drizzle/` (plataforma) — los snapshots de `drizzle/meta/` saltan del 0022
     al 0029 porque 0023–0028 se escribieron a mano sin actualizarlos, así que
     `generate` compara contra un esquema de hace seis migraciones y produce
     una que las REHACE todas (`CREATE TABLE platform_users`, `DROP COLUMN
     platform_role`…). Eso aborta el contenedor `migrate`, y como `web` solo
     arranca con `service_completed_successfully`, **el sitio no vuelve a
     levantar**. Si algún día se quiere recuperar `generate`, primero hay que
     reconstruir el snapshot contra la base real y comprobar que cuadra.
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

## Los skills del repositorio

Antes de trabajar en algo que caiga en uno de estos, léelo: llevan lo que ya se
midió y lo que ya salió mal, para no volver a descubrirlo.

| Skill | Cuándo |
|---|---|
| [`modelo-de-datos`](.claude/skills/modelo-de-datos/SKILL.md) | Añadir o cambiar tablas, columnas, índices o migraciones |
| [`clientes`](.claude/skills/clientes/SKILL.md) | Tocar el expediente fiscal o cualquier cosa que acabe en un CFDI |
| [`rendimiento`](.claude/skills/rendimiento/SKILL.md) | Antes de desplegar algo que toque listados o consultas |

Y la regla que los mantiene vivos: **lo que costó encontrar se escribe donde se
decide.** Un hallazgo que solo vive en un mensaje se pierde; en el comentario de
la función o en el skill, lo encuentra quien vuelva a pasar por ahí.

## Las pruebas

```
npm test                 las que no necesitan base — segundos
npm run pruebas:base     levanta la base de pruebas (una vez)
npm run test:integracion contra esa base
npm run test:todo        las dos
npm run test:ui          el panel de Vitest en el navegador
npm run probes:local     los que solo valen contra los datos reales
```

Ninguno pide que exportes nada. La base de pruebas es `evoelution_ci`, en tu
mismo servidor de Postgres: se toma el servidor de `.env.local` y se le cambia
el nombre de la base. El servidor se hereda, el destino **nunca** — así ninguna
prueba puede escribir en la copia de producción, que es lo que `.env.local`
apunta. `pruebas:base` además se niega a borrar una base cuyo nombre no termine
en `_ci`, `_test` o `_pruebas`.

GitHub Actions corre las dos primeras en cada PR y en cada push a la rama de
trabajo: 15 pruebas sin base y 27 contra la base sembrada. `pruebas/registro.ts`
dice qué prueba corre dónde y por qué.

1. **Un probe nuevo va al registro.** Hay una prueba que lo exige, así que no es
   opcional: si no lo clasificás, la suite se pone roja. Existe porque catorce
   probes llevaban meses reventando y otros catorce no comprobaban nada, y nadie
   lo sabía — figuraban como cobertura sin cubrir.
2. **Si lo querés en el CI, versionalo.** Los probes están en `.gitignore` por
   defecto; los que sostienen el flujo llevan su excepción explícita. El CI se
   cayó dos veces por esto y el error nunca se pareció a la causa.
3. **El CI no toca datos reales, y no es manía:** este repositorio es PÚBLICO y
   los registros de Actions también. La base se siembra con `seed-synthetic`. Lo
   que necesite el padrón de verdad va a `SOLO_LOCAL` y corre en tu máquina.
4. **`npm ci` es parte de la prueba.** Un `npm install` desde la Mac poda del
   candado entradas opcionales que Linux sí necesita —pasó con `@swc/helpers` y
   tumbó un despliegue— y el CI lo detecta ahora en el PR. Si tocás
   dependencias, revisá que el diff del candado no traiga BORRADOS.
5. **Los stubs no se tocan a la ligera.** `scripts/_stub-*.ts` sustituyen la
   sesión y el contexto de inquilino para que los probes puedan llamar a la capa
   de datos; `_stub-tenancy` devuelve rol `owner` y un `puedeEn()` que concede
   todo. Están en el repositorio, y lo que lo hace aceptable es la guardia de
   `scripts/_stub-guardia.ts`: cada uno revienta si se carga con `NEXT_RUNTIME`
   definido o en producción. **Nunca los importes desde `src/`, ni les quites la
   guardia, ni los mapees en `tsconfig.json`** — `probe-stubs.mts` comprueba las
   tres cosas y se pone rojo sin base de datos.
