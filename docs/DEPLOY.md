# Despliegue en producción

Un solo VPS con Docker Compose. La app, Postgres y nginx conviven en la misma
máquina: es lo que hace que cada consulta cueste ~0.3 ms en vez de los 15–30 ms
que costaría con una base remota. Para un portal que hace **varias consultas
por render**, esa localidad pesa más que cualquier otra optimización.

---

## Lo que se levanta

```
                    ┌──────────── VPS ────────────┐
  evoelution.com ──▶│ nginx :443                  │
                    │  ├─ /            → web      │
                    │  ├─ /uploads/    → volumen  │  (nginx sirve los JPG,
                    │  └─ /api/auth/*  → web      │   sin despertar a Node)
  cromatografia. ──▶│  └─ ML_DOMAIN    → evo_ai   │
   evoelution.com   │                             │
                    │ web (Next standalone)       │
                    │ postgres  ── volumen pgdata │
                    │ migrate   ── corre y sale   │
                    │ backup    ── pg_dump diario │
                    │ certbot   ── renueva TLS    │
                    └─────────────────────────────┘
```

Postgres **no expone ningún puerto**: solo lo alcanzan los contenedores de la
red interna. Para conectarte desde tu máquina, túnel SSH (ver más abajo).

---

## Requisitos

- **Un VPS con Docker y Docker Compose.** 4 vCPU / 8 GB es el punto dulce
  (Hetzner: `CPX31` en EE. UU., `CPX32` en Europa).

  Quien fija ese número es el **build**, no la operación ni el número de
  empresas: el compose construye la imagen en el servidor y `next build` es lo
  único de todo el stack que pide memoria de verdad. **Medido: 1.360 MB de
  pico**, muestreando el árbol de procesos de un build completo. Servir el ERP
  cuesta una fracción de eso.

  **Con 4 GB se puede**, y para una sola empresa va sobrado en operación, pero
  hay que dejar sitio al pico: bajá `PG_SHARED_BUFFERS` a `1GB` y
  `PG_EFFECTIVE_CACHE_SIZE` a `3GB` (ya está anotado en `deploy/.env.example`),
  y agregá 2 GB de swap como red de seguridad —el build es lo bastante corto
  como para que tocar swap no se note:

  ```bash
  fallocate -l 2G /swapfile && chmod 600 /swapfile
  mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ```

  **Con 2 GB no.** El pico del build por sí solo se come casi toda la RAM antes
  de contar Postgres ni el sistema.

  Si querés quedarte en 4 GB sin swap, el camino es sacar el build del
  servidor: construir la imagen en tu máquina o en CI y publicarla en un
  registro. Ahí el servidor solo la ejecuta, y 4 GB le sobran de largo.
- **Registros DNS de tipo A** apuntando a la IP del servidor, resolviendo
  **antes** de emitir certificados. Cuáles, según el modo (ver abajo).
  En modo `sslip` no hace falta ninguno: el nombre lo resuelve un DNS público.
- **Puertos 80 y 443 abiertos.**

### Los tres modos

Se elige con `NGINX_TEMPLATES` en `deploy/.env` y se cambia después sin tocar
código: la aplicación soporta los tres y decide según `ROOT_DOMAIN` esté
definida o no.

| | `una-empresa` (por defecto) | `multiempresa` | `sslip` |
|---|---|---|---|
| Dominios | `evoelution.com` | `astraion.com` + `*.astraion.com` | `5-75-1-2.sslip.io` + subdominios |
| ¿Hace falta comprar un dominio? | sí | sí | **no** |
| La empresa se resuelve por | primer segmento del path | subdominio | subdominio |
| DNS | registros A | registro A **comodín** | ninguno: lo resuelve sslip.io |
| Certificado | desafío HTTP | **comodín**, exige desafío DNS | desafío HTTP, un nombre por empresa |
| Dar de alta una empresa | nada que emitir | nada que emitir | **reemitir el certificado** |

Empezá en `una-empresa` si ya tenés el dominio: es el modo con menos piezas y
el certificado sale con un registro A. El comodín obliga a darle a certbot un
token de la API de tu proveedor de DNS, y eso conviene resolverlo cuando haya
un segundo cliente que lo justifique.

**`sslip` es para el servidor de estreno, antes de comprar el dominio.**
`sslip.io` es un DNS público que devuelve la IP que lleva el propio nombre
—`5-75-1-2.sslip.io` y `bajio.5-75-1-2.sslip.io` resuelven ambos a `5.75.1.2`—
así que da subdominios reales y HTTPS real sin registrar nada. Es el mismo
enrutado que `multiempresa`; lo único que cambia es cómo se emite el
certificado. El precio de no tener comodín: cada empresa entra por su nombre en
el certificado, y darla de alta obliga a reemitirlo.

> **No lo despliegues por HTTP plano para ahorrarte esto.** En producción la
> cookie de sesión se emite con el prefijo `__Secure-` y el atributo `secure`,
> así que el navegador la descarta sin decir nada: el formulario acepta la
> contraseña, responde 302, y no entra nadie. Es el fallo más caro de
> diagnosticar de todos porque no aparece ningún error en ninguna parte.

> **nginx no arranca si referencia un certificado que no existe.** Poner
> `multiempresa` sin haber emitido el comodín no degrada el servicio: tumba el
> sitio entero. Por eso el modo es explícito y no se deduce solo.

---

## Servidor sin dominio todavía (modo `sslip`)

Para estrenar el servidor antes de comprar el dominio. Da HTTPS real y
subdominios reales; lo único que se pierde es el comodín.

Con la IP del servidor —digamos `5.75.1.2`— en `deploy/.env`:

```ini
NGINX_TEMPLATES="sslip"
ROOT_DOMAIN="5-75-1-2.sslip.io"    # la IP con guiones en vez de puntos
APP_DOMAIN="5-75-1-2.sslip.io"     # el mismo valor
AUTH_DOMAIN="5-75-1-2.sslip.io"    # el mismo valor
ML_DOMAIN=""                       # se deriva: cromatografia.<apex>
TENANT_SLUGS="evoelution"          # las empresas que van en el certificado
```

Los tres dominios llevan el mismo valor y eso es correcto aquí: la plantilla de
`sslip` no declara un bloque aparte para `APP_DOMAIN`, así que no hay conflicto
de `server_name` —que sí lo habría en `multiempresa`, y nginx abortaría—.

Después, el despliegue es el mismo de abajo. No hace falta esperar a ningún
DNS: `sslip.io` ya resuelve.

```bash
./deploy/init-letsencrypt.sh --staging   # ensayo
./deploy/init-letsencrypt.sh             # en serio
```

Queda servido en:

```
https://5-75-1-2.sslip.io/consola              ← la consola de Astraion
https://5-75-1-2.sslip.io/login                ← puerta de los clientes
https://evoelution.5-75-1-2.sslip.io/dashboard ← el portal de una empresa
```

**Cada empresa nueva exige reemitir el certificado**, porque su nombre tiene que
entrar en él. Es un comando, y es exactamente el trabajo que el comodín ahorra:

```bash
./deploy/init-letsencrypt.sh --agregar acme
```

Si se olvida, el portal de esa empresa falla en el saludo TLS —el navegador
avisa de que el certificado no es para ese nombre— aunque todo lo demás esté
bien configurado.

### Cuando llegue el dominio

Es cambiar variables, no desplegar código:

```ini
NGINX_TEMPLATES="multiempresa"
ROOT_DOMAIN="tu-dominio.com"
APP_DOMAIN="…"                 # ahora sí, distinto de ROOT_DOMAIN
```

…emitir el comodín como indica `init-letsencrypt.sh` al terminar, y recargar
nginx. Las direcciones de `sslip.io` dejan de servirse; conviene avisar antes
si alguien ya las tenía guardadas.

---

## Primer despliegue

```bash
# 1. Clonar. Si vas a levantar también el módulo de cromatografía, los dos
#    repos tienen que quedar hermanos: el compose referencia ../evo_ai
git clone <repo> evoelution/web_evoelution
cd evoelution/web_evoelution

# 2. Configuración. deploy/.env NO va al repo: ahí viven los secretos.
cp deploy/.env.example deploy/.env
nano deploy/.env

# 3. Secretos reales. NO reutilices los de desarrollo:
#    quien tenga AUTH_SECRET puede firmar sesiones válidas y entrar como
#    cualquier usuario, incluido un admin.
#
#    Generá TAMBIÉN MAIL_SECRET, aunque todavía no mandes correo. Es con lo
#    que se cifran las contraseñas SMTP de cada empresa, y si se deja vacía se
#    deriva de AUTH_SECRET: el día que alguien rote AUTH_SECRET, las
#    contraseñas de correo de todos los clientes dejan de descifrarse y el
#    síntoma es "dejó de salir el correo", sin ninguna pista que lleve ahí.
openssl rand -base64 32   # → AUTH_SECRET
openssl rand -base64 32   # → MAIL_SECRET
# POSTGRES_PASSWORD va dentro de la URL de conexión: sin símbolos, o la parte
openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 24; echo

# 4. Certificados TLS. Probá primero contra el entorno de pruebas de Let's
#    Encrypt: el límite real es de 5 emisiones por dominio por semana y se
#    agota rápido depurando DNS.
./deploy/init-letsencrypt.sh --staging
./deploy/init-letsencrypt.sh          # ya en serio

# 5. Arriba
docker compose -f docker-compose.prod.yml --env-file deploy/.env up -d --build

# …con el módulo de cromatografía:
docker compose -f docker-compose.prod.yml --env-file deploy/.env \
  --profile cromatografia up -d --build
```

Verificar:

```bash
curl https://evoelution.com/api/health     # {"status":"ok","db":"up"}
docker compose -f docker-compose.prod.yml ps
```

### Dar de alta la primera empresa

El servicio `migrate` crea el **plano de control** —`tenants`, `users`,
`memberships`— y nada más. Las tablas de negocio viven en el esquema de cada
empresa, así que hasta que exista una empresa no hay dónde guardar un ticket.

Este paso es obligatorio en un servidor nuevo, y va **antes** del seed:

```bash
C="docker compose -f docker-compose.prod.yml --env-file deploy/.env"

# 1. Crea el esquema tenant_evoelution, le aplica las migraciones de negocio
#    y lo registra. El prefijo es el de los folios: EVO-000001.
$C run --rm --entrypoint "npx tsx scripts/tenant.ts provision \
  --slug evoelution --name 'Evoelution' --prefix EVO" migrate

# 2. Comprobar
$C run --rm --entrypoint "npx tsx scripts/tenant.ts list" migrate
```

### Cargar los datos iniciales

Crea el usuario administrador y unos datos de ejemplo **dentro** de esa empresa:

```bash
$C run --rm --entrypoint "npx tsx scripts/seed.ts" migrate
```

**Cambiá la contraseña del admin apenas entres.** El seed usa una conocida y
está en el repo.

### Crear el primer operador de Astraion

**Sin esto nadie puede entrar a la consola.** Quien opera la plataforma vive en
`platform_users`, una tabla aparte de quien la usa, y en una base nueva nace
vacía: el seed no la toca, porque las cuentas que crea son de una empresa.

```bash
$C run --rm --entrypoint "npx tsx scripts/tenant.ts grant \
  --email admin@astraion.com --role superadmin --name 'Administrador'" migrate
```

Imprime una contraseña generada **una sola vez**: copiala antes de cerrar la
terminal. Con ella se entra por `/consola`, que es una puerta distinta de la de
los clientes:

| | puerta | tabla | quién |
|---|---|---|---|
| Astraion | `/consola` | `platform_users` | opera el producto: ve todas las empresas y entra a cualquiera **en solo lectura** |
| Empresa | `/login` | `users` | trabaja dentro de una empresa |

Son dos cuentas aunque sean la misma persona, y no comparten contraseña.

> Usá un correo de **tu** dominio, no del de un cliente. Un
> `admin@evoelution.com` operando Astraion mezcla las dos cosas justo donde se
> acaban de separar, y el rastro de la bitácora queda a nombre del cliente.

`--role support` da una cuenta que entra a diagnosticar pero no da de alta
empresas ni aprueba solicitudes.

### Al agregar la empresa número dos

```bash
$C run --rm --entrypoint "npx tsx scripts/tenant.ts provision \
  --slug acme --name 'ACME Labs' --prefix ACM" migrate
```

En modo `sslip`, además, hay que meterla en el certificado:

```bash
./deploy/init-letsencrypt.sh --agregar acme
```

Y si querés darle subdominio propio bajo un dominio de verdad, ahí sí se pasa a
`multiempresa`: cambiás `NGINX_TEMPLATES` y `ROOT_DOMAIN` en `deploy/.env`,
emitís el comodín como indica `init-letsencrypt.sh` al terminar, y recargás
nginx. Sin desplegar código nuevo.

---

## Actualizar

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file deploy/.env up -d --build
```

Las migraciones se aplican solas: el servicio `migrate` corre antes que `web`,
y `web` solo arranca si terminó bien (`service_completed_successfully`). Así
nunca queda una versión de la app corriendo contra un schema viejo.

> **Nunca `db:push` en producción.** Sincroniza el schema por diferencia, sin
> historial ni control de lo que hace, y puede descartar datos. El deploy usa
> `drizzle-kit migrate`, que aplica los `.sql` versionados y registra cuáles ya
> corrieron.

---

## Respaldos

Son dos servicios, y hacen falta los dos:

- **`backup`** — `pg_dump` diario al volumen `backups`, borrando los de más de
  `BACKUP_RETENTION_DAYS` (14 por defecto). Siempre activo.
- **`backup-offsite`** — copia esos dumps FUERA del servidor con rclone. Va en
  el perfil `respaldo-remoto` porque necesita credenciales que hay que sacar
  aparte.

> **No cargues datos reales sin el segundo.** Un respaldo en el mismo disco que
> la base no protege del caso que más importa —perder ese disco— y desde que
> existen cuentas por pagar, en esa base hay dinero.

Configuralo en `deploy/.env` (hay ejemplos ahí para Storage Box de Hetzner y
para S3/Backblaze) y levantalo:

```bash
docker compose -f docker-compose.prod.yml --env-file deploy/.env \
  --profile respaldo-remoto up -d
```

Copia 20 minutos después del dump, para no llevarse un archivo a medio
escribir. Usa `copy` y no `sync` a propósito: `sync` borraría en el destino lo
que ya no está en el origen, o sea que la retención local de 14 días se
propagaría al remoto y perderías la copia vieja justo cuando la necesitás.

**Comprobá que corre.** Un respaldo que falla en silencio es peor que no tener
ninguno, porque te deja tranquilo:

```bash
docker compose -f docker-compose.prod.yml logs backup-offsite | tail -5
# [offsite] ok           ← bien
# [offsite] FALLÓ …      ← el respaldo NO salió del servidor
```

### Restaurar

```bash
# Ver los que hay
docker compose -f docker-compose.prod.yml exec backup ls -lh /backups

# Restaurar entero
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U evoelution -d evoelution --clean --if-exists < backup.dump
```

**Restaurar una sola empresa** sin tocar a las demás — que es el caso real,
alguien borró algo por error:

```bash
# Del dump completo, solo su esquema
pg_restore -n tenant_evoelution -d evoelution --clean --if-exists backup.dump
```

Funciona porque el aislamiento es por esquema: `-n` recorta el dump a una
empresa. Con un `tenant_id` compartido habría que reconstruir a mano fila por
fila.

Las **fotos de equipos** viven en el volumen `uploads` y no entran en el dump
de Postgres. Respaldalas aparte:

```bash
docker run --rm -v web_evoelution_uploads:/data -v $(pwd):/out alpine \
  tar czf /out/uploads-$(date +%F).tar.gz -C /data .
```

---

## Operación

```bash
# Logs
docker compose -f docker-compose.prod.yml logs -f web

# Consola de Postgres
docker compose -f docker-compose.prod.yml exec postgres psql -U evoelution -d evoelution

# Postgres desde tu máquina (no expone puerto a internet, va por SSH)
ssh -L 5433:localhost:5432 usuario@servidor
# y en otra terminal: psql postgresql://evoelution:...@localhost:5433/evoelution

# Recargar nginx tras tocar la plantilla
docker compose -f docker-compose.prod.yml restart nginx
```

---

## Decisiones y sus límites

**Una sola instancia de la app.** Las fotos van a un volumen local, así que la
app está atada a esta máquina. Escalar a varias instancias exige mover los
uploads a almacenamiento de objetos (S3/R2) primero — `saveImage()` mantiene la
firma justamente para que ese cambio no toque a ninguno de sus llamadores.

**Postgres en el mismo host.** Compra latencia mínima y cuesta cero; a cambio,
los respaldos son tu responsabilidad. Por eso el servicio `backup` viene en el
compose y no como una recomendación suelta.

**Vercel no es opción hoy**, y no por preferencia: su filesystem es de solo
lectura y efímero, así que las fotos de equipos fallarían al subir o
desaparecerían en el siguiente deploy. Habría que migrar a object storage
primero. Sumado a eso, en serverless cada instancia abre su propio pool contra
Postgres y hay que meter un pooler en modo *transaction* — las transacciones de
la Fase 0 no funcionan en modo *statement*.

**El módulo de cromatografía es opcional.** Sin el perfil `cromatografia`,
nginx devuelve 502 solo en ese subdominio y el resto sigue funcionando: los
`proxy_pass` de ese bloque usan variables a propósito, para que nginx arranque
aunque esos contenedores no existan en vez de negarse a iniciar y tumbar
también el sitio principal.

---

## Qué se verificó, y qué no

**Verificado en local**, sobre el build de producción real (`output:
standalone`, `NODE_ENV=production`), no sobre el dev server:

- El binario arranca y `/api/health` responde `{"status":"ok","db":"up"}`.
- Rutas públicas (`/`, `/es`, `/en`, `/es/contacto`) y portal autenticado
  (dashboard, CRM, informes, refacciones, tickets, contratos, leads,
  rentabilidad, usuarios): todas 200, con login por credenciales real.
- `saveImage()` escribe en `UPLOADS_DIR` y **no** en `public/` del proyecto;
  respeta formatos permitidos y sanea el subdirectorio.

Del **modo `sslip`**, lo que sí se pudo comprobar sin servidor:

- `sslip.io` resuelve como promete: `5-75-1-2.sslip.io` y
  `bajio.5-75-1-2.sslip.io` devuelven ambos `5.75.1.2`.
- La aplicación reconoce esos hosts sin tocar una línea de código. Los nueve
  casos del enrutado por subdominio con `ROOT_DOMAIN=5-75-1-2.sslip.io`: el
  apex no es una empresa, `www` y `cromatografia` siguen reservados,
  `bajio.<apex>` da `bajio` con puerto y en mayúsculas, y un host de **otra**
  IP no se acepta.
- `bash -n` sobre `init-letsencrypt.sh` y el YAML del compose parsean.

**No verificado** — hace falta el servidor:

- La emisión de certificados de `init-letsencrypt.sh`, en cualquier modo.
- El build de la imagen Docker y el arranque del stack completo.
- **La plantilla de nginx del modo `sslip` no pasó por `nginx -t`**: no hay
  Docker ni nginx en la máquina donde se escribió. Está calcada de la de
  `multiempresa`, que sí está en uso, pero eso es un argumento y no una prueba.
  El primer `docker compose up -d nginx` del servidor es quien la valida.

Nada de eso se puede probar sin un VPS. Lo que era verificable —el build de la
app y el enrutado por host— está verificado.
