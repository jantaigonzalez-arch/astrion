#!/usr/bin/env bash
#
# Trae la base de PRODUCCIÓN a la base LOCAL.
#
#   scripts/sync-desde-prod.sh [--sin-migrar] [--db <nombre>] [--sin-red]
#
# Para qué: probar contra los datos de verdad —161 clientes, 633 tickets, los
# folios y los importes reales— antes de tocar el servidor. Una migración que
# se ve bien contra una base sembrada puede tardar minutos o romper una
# restricción contra la base real; esto lo descubre en tu máquina.
#
# ─────────────────────────────────────────────────────────────────────────────
# LA DIRECCIÓN ES SIEMPRE PROD → LOCAL. NUNCA AL REVÉS.
#
# En producción este script solo ejecuta `pg_dump`, que lee. No hay ninguna
# ruta por la que escriba allá. Y antes de tocar la base local comprueba que
# DATABASE_URL apunte a localhost: si algún día alguien lo corre con el .env
# del servidor cargado, aborta en vez de borrarle la base a la empresa.
# ─────────────────────────────────────────────────────────────────────────────
#
# Lo que hace, en orden:
#
#   1. Respalda tu base local (red de salvación: lo que tengas sembrado no se
#      pierde, se puede volver con pg_restore).
#   2. Vuelca producción por SSH.
#   3. Recrea la base local y restaura ese volcado.
#   4. Aplica las migraciones pendientes — ESTE es el ensayo que importa: es
#      exactamente lo que hará el servicio `migrate` en el servidor.
#   5. NEUTRALIZA lo que puede salir de tu máquina (ver `desarmar()`).
#
set -euo pipefail

cd "$(dirname "$0")/.."

SERVIDOR="${SERVIDOR_PROD:-astrion-srv}"
CONTENEDOR="web_evoelution-postgres-1"
USUARIO_PG="evoelution"
BASE_PROD="evoelution"
CLAVE_DEV="${CLAVE_DEV:-Dev123!}"

migrar=1
descargar=1
db_destino=""
while [ $# -gt 0 ]; do
  case "$1" in
    --sin-migrar) migrar=0 ;;
    # Reusa el último volcado descargado en vez de pedir uno nuevo. Útil para
    # repetir la prueba sin volver a molestar al servidor.
    --sin-red)    descargar=0 ;;
    --db)         db_destino="${2:?--db necesita un nombre}"; shift ;;
    -h|--help)    sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; exit 1 ;;
  esac
  shift
done

# Las herramientas de Postgres no están en el PATH por defecto con Homebrew.
command -v psql >/dev/null || export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
for bin in psql pg_restore pg_dump node; do
  command -v "$bin" >/dev/null || { echo "Falta \`$bin\` en el PATH. Si es node: \`nvm use\`." >&2; exit 1; }
done

url_local="$(grep -E '^DATABASE_URL=' .env.local | head -1 | cut -d= -f2- | tr -d '"'"'"'')"
[ -n "$url_local" ] || { echo "No encontré DATABASE_URL en .env.local" >&2; exit 1; }

# ── El guardia ───────────────────────────────────────────────────────────────
# Se comprueba el HOST, no el nombre de la base: en producción la base también
# se llama `evoelution`, así que el nombre no distingue nada. Lo que distingue
# es dónde vive.
host="$(node -e 'process.stdout.write(new URL(process.argv[1]).hostname)' "$url_local")"
case "$host" in
  localhost|127.0.0.1|::1) ;;
  *)
    echo "ABORTADO: DATABASE_URL apunta a \"$host\", que no es tu máquina." >&2
    echo "Este script RECREA la base de destino. Solo corre contra localhost." >&2
    exit 1 ;;
esac

db="${db_destino:-$(node -e 'process.stdout.write(new URL(process.argv[1]).pathname.slice(1))' "$url_local")}"
url_admin="$(node -e '
  const u = new URL(process.argv[1]); u.pathname = "/postgres";
  process.stdout.write(u.toString())' "$url_local")"
url_destino="$(node -e '
  const u = new URL(process.argv[1]); u.pathname = "/" + process.argv[2];
  process.stdout.write(u.toString())' "$url_local" "$db")"

mkdir -p .sync
sello="$(date +%Y%m%d-%H%M%S)"
volcado_prod=".sync/prod-${sello}.dump"
volcado_local=".sync/local-antes-de-${sello}.dump"

echo
echo "▸ Destino local : $db en $host"
echo "▸ Origen        : $SERVIDOR (solo lectura)"

# ── 1. Red de salvación ──────────────────────────────────────────────────────
# Antes de destruir nada. Si el volcado de producción viene mal, o si tenías
# algo sembrado que hacía falta, se vuelve con:
#   pg_restore -d "$DATABASE_URL" --clean --if-exists .sync/local-antes-de-*.dump
if psql "$url_destino" -tAc 'select 1' >/dev/null 2>&1; then
  echo "▸ Respaldando tu base local → $volcado_local"
  pg_dump "$url_destino" -Fc --no-owner --no-privileges > "$volcado_local"
else
  echo "▸ La base local no existe todavía; no hay nada que respaldar."
fi

# ── 2. Volcado de producción ─────────────────────────────────────────────────
# `--no-owner --no-privileges` porque allá las tablas son del rol `evoelution` y
# aquí de tu usuario: sin esto, la restauración se llena de errores por un rol
# que en tu máquina no existe.
if [ "$descargar" = 1 ]; then
  echo "▸ Volcando producción…"
  ssh "$SERVIDOR" "docker exec $CONTENEDOR pg_dump -U $USUARIO_PG -d $BASE_PROD -Fc --no-owner --no-privileges" \
    > "$volcado_prod"
else
  volcado_prod="$(ls -t .sync/prod-*.dump 2>/dev/null | head -1)"
  [ -n "$volcado_prod" ] || { echo "No hay ningún volcado previo en .sync/" >&2; exit 1; }
  echo "▸ Reusando $volcado_prod (--sin-red)"
fi
echo "  $(du -h "$volcado_prod" | cut -f1) en $volcado_prod"

# ── 3. Recrear y restaurar ───────────────────────────────────────────────────
# Se recrea en vez de restaurar encima a propósito: `--clean` no borra los
# esquemas que ya no están en el origen, así que los inquilinos de prueba que
# tengas en local (tenant_acme, tenant_bajio) sobrevivirían y acabarías con una
# base que no se parece a ninguna de las dos.
#
# `with (force)` corta las conexiones abiertas, y eso incluye las de un
# `npm run dev` que esté corriendo: su pool se queda apuntando a una base que ya
# no existe y el servidor deja de responder sin decir por qué. Se avisa antes,
# porque el síntoma —«se me colgó el dev»— no se parece en nada a la causa.
abiertas="$(psql "$url_admin" -tAc \
  "select count(*) from pg_stat_activity where datname = '$db'" 2>/dev/null || echo 0)"
if [ "${abiertas:-0}" -gt 0 ]; then
  echo "  ⚠ Hay $abiertas conexión(es) abierta(s) a \"$db\" (¿npm run dev?)."
  echo "    Se van a cortar: REINICIÁ el servidor de desarrollo al terminar."
fi

echo "▸ Recreando la base local…"
psql "$url_admin" -v ON_ERROR_STOP=1 -qc "drop database if exists \"$db\" with (force)"
psql "$url_admin" -v ON_ERROR_STOP=1 -qc "create database \"$db\""
pg_restore -d "$url_destino" --no-owner --no-privileges --exit-on-error "$volcado_prod"

# ── 4. El ensayo de la migración ─────────────────────────────────────────────
# Ahora la base local está en la MISMA versión de esquema que producción. Correr
# aquí las migraciones que trae tu rama es exactamente lo que hará `migrate` en
# el servidor, contra el mismo volumen de datos. Si algo va a fallar allá, falla
# aquí primero — que es el punto de todo esto.
if [ "$migrar" = 1 ]; then
  echo "▸ Aplicando migraciones pendientes (ensayo de lo que hará producción)…"
  npm run --silent db:migrate
  npx tsx scripts/tenant.ts migrate
fi

# ── 5. Desarmar lo que puede salir de tu máquina ─────────────────────────────
desarmar() {
  # El buzón SMTP de cada empresa. Esto NO es higiene: `lib/mail/index.ts` da
  # prioridad al SMTP del inquilino por encima del proveedor global, así que una
  # copia sin desarmar haría que tu `npm run dev` mandara correo DE VERDAD, con
  # el remitente del cliente, a las direcciones reales de la tabla. Un ticket de
  # prueba avisaría a un laboratorio.
  #
  # (La contraseña va cifrada con una clave derivada de AUTH_SECRET, y el tuyo
  # es otro: no se podría descifrar. Se borra igual — no se guarda el secreto de
  # un cliente en un portátil porque «total, no abre».)
  psql "$url_destino" -v ON_ERROR_STOP=1 -q <<'SQL'
update tenants set smtp_host = null, smtp_port = null, smtp_user = null,
                   smtp_password = null, smtp_checked_at = null,
                   mail_verified_at = null;
SQL

  # Las contraseñas. Los hashes reales del personal no tienen por qué acabar en
  # un portátil, así que se sustituyen por una de desarrollo conocida.
  #
  # A quien en producción NO tiene contraseña se le pone una SI es del equipo
  # —los seis técnicos entraron por el importador sin poder iniciar sesión— y no
  # se le pone si es un laboratorio cliente. La diferencia es deliberada:
  # probar la cola de tickets exige entrar como técnico, mientras que un cliente
  # que en producción no puede entrar tampoco debe poder aquí, o la copia
  # mentiría justo sobre la parte que se le enseña al cliente.
  local hash
  hash="$(node -e 'process.stdout.write(require("bcryptjs").hashSync(process.argv[1], 10))' "$CLAVE_DEV")"
  psql "$url_destino" -v ON_ERROR_STOP=1 -q \
    -c "update users u set password_hash = '$hash'
          where exists (select 1 from memberships m
                         where m.user_id = u.id and m.role in ('owner','admin','agent'))
             or u.password_hash is not null" \
    -c "update platform_users set password_hash = '$hash' where password_hash is not null"
}
echo "▸ Desarmando correo y contraseñas…"
desarmar

# ── Resumen ──────────────────────────────────────────────────────────────────
echo
psql "$url_destino" -qtAc "
  select '  ' || slug || ' → ' || coalesce(s.schema_name, '(sin esquema)')
    from tenants t left join tenant_schemas s on s.tenant_id = t.id order by 1"
psql "$url_destino" -qtAc "
  select '  ' || (select count(*) from tenant_evoelution.tickets) || ' tickets · '
      || (select count(*) from tenant_evoelution.crm_organizations) || ' organizaciones · '
      || (select count(*) from tenant_evoelution.contracts) || ' contratos'" 2>/dev/null || true
cat <<EOF

  Entrá con cualquier correo de la base y la contraseña: $CLAVE_DEV
  El correo NO sale de tu máquina (transporte de consola).
  Las fotos de equipos no viajan en el volcado: se verán rotas. Ver docs/ENTORNOS.md.

  Volver atrás:  pg_restore -d "\$DATABASE_URL" --clean --if-exists $volcado_local

EOF
