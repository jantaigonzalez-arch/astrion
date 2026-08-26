# Desarrollo y producción

Hay **dos** entornos y uno solo de ellos tiene clientes dentro. Este documento
dice cuál es cuál, cómo se pasa de uno al otro y qué no se hace nunca.

La regla que resume todo lo demás:

> **Se prueba en local contra una copia de producción. A producción solo llega
> lo que ya funcionó aquí.**

---

## Los dos entornos

| | **DEV (local)** | **PROD (Hetzner)** |
|---|---|---|
| Dónde | tu máquina | `astrion-srv` · Helsinki · 4 GB |
| Base | Postgres 16 de Homebrew, `postgresql://…@localhost:5432/evoelution` | Postgres 16 en contenedor, sin puerto expuesto |
| Aplicación | `npm run dev` en `:3002` | `docker compose -f docker-compose.prod.yml` |
| Se llega por | `astraion.test:3002`, `evoelution.astraion.test:3002` | https://2-29-3-213.sslip.io |
| Código | tu árbol de trabajo | `git pull` desde GitHub, rama `astraion/erp-ventas-servicio-ml` |
| Correo | transporte de consola: se imprime, no sale nada | Resend / SMTP de la empresa |
| Datos | copia de producción, desarmada | **los de verdad** |

**Cómo distinguirlos sin pensar:** si el comando lleva `ssh astrion-srv` o
`docker compose`, es producción. Si no, es tu máquina.

La base de las dos se llama `evoelution` y el rol de las dos es `evoelution`.
El nombre no distingue nada — lo que distingue es el **host**. Por eso el script
de sincronización comprueba el host y no el nombre.

---

## El ciclo

```
  1. sincronizar   npm run sync:prod          prod ──▶ local (solo lectura allá)
  2. trabajar      npm run dev                contra los datos de verdad
  3. probar        npm run typecheck && npm run lint
  4. commitear     git commit && git push     ← el servidor despliega desde GitHub
  5. desplegar     npm run deploy:prod
  6. verificar     el script lo hace: contenedores + HTTP 200
```

El paso 4 no es burocracia: producción hace `git pull` con su propia llave de
solo lectura, así que **un archivo guardado y no empujado no llega**. El script
de despliegue aborta si tu árbol está sucio o si tu HEAD no está en origin,
justo para que el síntoma no sea «desplegué y no cambió nada».

---

## 1. Traer producción a local

```bash
npm run sync:prod                  # volcado fresco + restauración + migraciones
npm run sync:prod -- --sin-red     # reusa el último volcado descargado
npm run sync:prod -- --sin-migrar  # deja el esquema tal cual está en producción
```

Tarda menos de un minuto y **en producción solo ejecuta `pg_dump`**. No hay
ninguna ruta por la que este script escriba allá.

Antes de tocar tu base local, respalda lo que tengas (`.sync/local-antes-de-*.dump`),
así que sincronizar nunca te deja sin lo que estabas probando:

```bash
pg_restore -d "$DATABASE_URL" --clean --if-exists .sync/local-antes-de-<sello>.dump
```

### Lo que desarma al restaurar, y por qué

**El buzón SMTP de cada empresa.** Esto no es higiene, es lo que impide un
accidente concreto: `lib/mail/index.ts` le da prioridad al SMTP del inquilino
por encima del proveedor global. Con la tabla `tenants` copiada tal cual, tu
`npm run dev` mandaría correo **de verdad**, con el remitente del cliente, a las
direcciones reales que acabás de copiar. Un ticket de prueba avisaría a un
laboratorio. Se anulan `smtp_*` y `mail_verified_at`, y el correo vuelve al
transporte de consola.

**Las contraseñas.** Todas pasan a una de desarrollo: `Dev123!`. Los hashes
reales del personal no tienen por qué vivir en un portátil, y de paso podés
entrar como cualquiera para reproducir lo que te reportan.

Con un matiz deliberado: a los **técnicos** se les pone contraseña aunque en
producción no la tengan —entraron por el importador y no pueden iniciar sesión
hasta que los inviten—, porque probar la cola de tickets exige entrar como
técnico. A los **laboratorios cliente** no. Un cliente que en producción no
puede entrar tampoco entra aquí, o la copia mentiría justo sobre la parte que se
le enseña al cliente.

### Lo que no viaja en el volcado

- **Las fotos de equipos.** Viven en el volumen `uploads`, no en Postgres: en
  local se ven rotas. Si hacen falta:
  ```bash
  ssh astrion-srv 'docker run --rm -v web_evoelution_uploads:/d alpine tar cz -C /d .' \
    | tar xz -C public/uploads/
  ```
- **El lago analítico** (`.lake/`). Se regenera con `scripts/extract.ts`.
- **Los certificados y el `.env` del servidor.** Tu `.env.local` es tuyo y no se
  toca; en particular tu `AUTH_SECRET` es otro, así que ni siquiera podrías
  descifrar las contraseñas de correo copiadas. Se borran igual.

### La copia trae datos de clientes reales

161 organizaciones con su RFC y domicilio, importes de contratos, 633 tickets.
`.sync/` está en `.gitignore` y ahí se queda. Que el disco esté cifrado
(FileVault) y que esos volcados no se compartan por chat no es una formalidad:
es el mismo dato que en producción está detrás de TLS y una contraseña.

---

## 2. Ensayar una migración

Es el caso que justifica todo lo demás. Una migración que corre en un segundo
contra una base sembrada puede tardar minutos o chocar con una restricción
contra los datos reales — y en producción corre **antes** de que arranque la
aplicación.

```bash
npm run sync:prod        # deja la base local en la MISMA versión que producción
                         # y aplica encima lo que traiga tu rama
```

Eso último es exactamente lo que hará el servicio `migrate` en el servidor,
sobre el mismo volumen de datos. Si algo va a fallar allá, falla acá primero.

Para verlo en dos pasos:

```bash
npm run sync:prod -- --sin-migrar   # 1. quedás igual que producción
npm run db:migrate                  # 2. plano de control (public)
npx tsx scripts/tenant.ts migrate   # 3. cada esquema tenant_<slug>
```

> **Las migraciones de inquilino (`drizzle-tenant/`) se escriben a mano** desde
> la `0013`. La cadena de instantáneas de `meta/` se cortó ahí —hay journal
> hasta la 19 pero snapshots solo hasta la 12—, así que `drizzle-kit generate`
> con `drizzle.tenant.config.ts` compara contra el estado de la 0012 y propone
> volver a crear todo lo que vino después: 49 líneas de `CREATE TABLE` sobre
> tablas que ya existen, que fallarían al aplicarse. Las del plano de control
> (`drizzle/`, `npm run db:generate`) sí se generan normal.



---

## 3. Ensayar una carga de datos

El importador de datos heredados (`scripts/import-legacy.ts`) es transaccional,
pero `--wipe` **borra** lo importable antes de recargar. Eso se ensaya en local,
no en producción:

```bash
# 1. en seco: no abre ninguna conexión, solo cruza los archivos y reporta
npx tsx scripts/import-legacy.ts --dir <carpeta> --dry-run

# 2. contra la copia local
npx tsx scripts/import-legacy.ts --dir <carpeta> --tenant evoelution --wipe

# 3. revisar el reporte y la base
head -1 <carpeta>/import-report.csv && wc -l <carpeta>/import-report.csv
```

Recién entonces, en producción — y no reconstruye la aplicación, solo la imagen
que corre los scripts, así que **el sitio no se cae**:

```bash
npm run deploy:prod -- --solo-migrate
scp -r <carpeta> astrion-srv:/root/import
ssh astrion-srv 'cd /root/web_evoelution && docker compose -f docker-compose.prod.yml \
  --env-file deploy/.env run --rm -v /root/import:/data/import \
  --entrypoint "npx tsx scripts/import-legacy.ts --dir /data/import --tenant evoelution" migrate'
```

> `--wipe` no borra `domain_events`: la bitácora es append-only por diseño (un
> trigger de Postgres rechaza el DELETE). Tras reimportar quedan eventos de la
> corrida anterior apuntando a filas que ya no existen. Es lo correcto para una
> auditoría —esa carga ocurrió— pero es la razón de no reimportar muchas veces
> sobre una base que ya opera.

---

## 4. Desplegar

```bash
npm run deploy:prod                    # todo. Corte de menos de un minuto.
npm run deploy:prod -- --solo-migrate  # solo la imagen de scripts. Sin corte.
```

Antes de tocar nada, el script comprueba que tu árbol esté limpio, que tu HEAD
esté en origin, y te enseña **qué commits** van a entrar. Si entre ellos hay
migraciones lo dice con todas las letras, porque una migración es lo único de un
despliegue que no se deshace con un `git revert`.

`--solo-migrate` sirve cuando el cambio está en `scripts/` y no en la
aplicación: reconstruye la imagen que corre los scripts y no toca `web`.

En el modo completo, `migrate` corre primero y `web` solo arranca si aquello
terminó bien (`service_completed_successfully`). Si una migración falla, la
versión vieja sigue sirviendo contra el esquema viejo — que es el estado
correcto en el que quedarse.

### Si algo sale mal

1. **Fallo de la aplicación**: `git revert` + `npm run deploy:prod`. La imagen
   se reconstruye desde el commit anterior.
2. **Fallo de una migración**: el despliegue se detiene solo y `web` sigue con
   la versión vieja. Se arregla hacia adelante, con otra migración.
3. **Datos perdidos**: hay un `pg_dump` diario en el volumen `backups`
   (`docs/DEPLOY.md` → Restaurar). Una sola empresa se restaura sin tocar a las
   demás con `pg_restore -n tenant_evoelution`, porque el aislamiento es por
   esquema.

---

## Reglas

1. **Producción no se edita.** Nada de `vim` en el servidor. Un parche en vivo
   deja un árbol que nadie puede reproducir y el siguiente `git pull` choca —
   ya pasó, el 2026-08-24.
2. **Todo cambio va por GitHub.** El servidor despliega con `git pull`.
3. **En producción, leer es libre; escribir se avisa.** Diagnosticar (`docker
   ps`, `logs`, un `select`) no necesita permiso. Reconstruir, migrar,
   importar, borrar o reiniciar, sí.
4. **Ninguna migración ni importación llega a producción sin haber corrido antes
   contra una copia sincronizada.**
5. **`--wipe` y `drop` nunca se corren en producción de primera intención.**
6. **La sincronización va en un solo sentido.** No existe local → prod, y no se
   escribe uno.

---

## Referencia

```bash
# --- DEV ---------------------------------------------------------------
npm run dev -- -p 3002          # http://astraion.test:3002
npm run sync:prod               # traer producción (ver arriba)
npm run typecheck && npm run lint
npx tsx scripts/tenant.ts list  # inquilinos y versión de esquema

# --- PROD (lectura) ----------------------------------------------------
ssh astrion-srv 'docker ps'
ssh astrion-srv 'cd /root/web_evoelution && git log --oneline -1'
ssh astrion-srv 'docker compose -f docker-compose.prod.yml logs --tail 50 web'
ssh astrion-srv 'docker exec web_evoelution-postgres-1 psql -U evoelution -d evoelution -c "…"'

# --- PROD (escritura: avisar antes) ------------------------------------
npm run deploy:prod
npm run deploy:prod -- --solo-migrate
```

El runbook completo del servidor —modos de dominio, certificados, respaldos,
requisitos de RAM— está en [`DEPLOY.md`](./DEPLOY.md).
