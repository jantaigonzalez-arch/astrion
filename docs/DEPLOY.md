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

- Un VPS con Docker y Docker Compose. Hetzner CPX22 (3 vCPU / 8 GB, ~€8/mes)
  sobra para el volumen actual.
- Tres registros DNS de tipo **A** apuntando a la IP del servidor:
  `evoelution.com`, `www.evoelution.com` y `cromatografia.evoelution.com`.
  Deben resolver **antes** de emitir certificados.
- Puertos 80 y 443 abiertos.

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
openssl rand -base64 32   # → AUTH_SECRET
openssl rand -base64 24   # → POSTGRES_PASSWORD

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

### Cargar los datos iniciales

Solo la primera vez, para crear el usuario admin y los catálogos:

```bash
docker compose -f docker-compose.prod.yml run --rm --entrypoint \
  "npx tsx scripts/seed.ts" migrate
```

**Cambiá la contraseña del admin apenas entres.** El seed usa una conocida y
está en el repo.

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

El servicio `backup` hace un `pg_dump` diario al volumen `backups` y borra los
de más de `BACKUP_RETENTION_DAYS` (14 por defecto).

```bash
# Ver los que hay
docker compose -f docker-compose.prod.yml exec backup ls -lh /backups

# Bajarlos a tu máquina — HACELO: un respaldo que vive en el mismo disco que
# la base no protege del caso que más importa, que es perder ese disco.
docker compose -f docker-compose.prod.yml cp backup:/backups ./backups-local

# Restaurar
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U evoelution -d evoelution --clean --if-exists < backup.dump
```

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

**No verificado** — hace falta el servidor:

- La emisión de certificados de `init-letsencrypt.sh`: requiere DNS público
  apuntando al host.
- El build de la imagen Docker y el arranque del stack completo.
- El enrutado de nginx entre los dos dominios.

Nada de eso se puede probar sin un VPS y DNS reales. El build de la app, que sí
era verificable, está verificado.
