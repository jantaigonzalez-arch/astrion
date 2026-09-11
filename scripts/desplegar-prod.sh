#!/usr/bin/env bash
#
# Lleva a PRODUCCIÓN lo que ya está probado en local.
#
#   scripts/desplegar-prod.sh [--solo-migrate] [--si]
#
# Producción despliega desde GITHUB, no desde tu disco: el servidor hace `git
# pull` con su propia llave de solo lectura. Por eso lo primero que comprueba
# este script es que lo que estás por desplegar exista allá arriba — un archivo
# guardado y no commiteado no llega, y el síntoma sería «desplegué y no cambió
# nada».
#
# Dos modos:
#
#   (por defecto)     reconstruye TODO. `migrate` corre y, solo si sale bien,
#                     `web` se reemplaza. Corte de menos de un minuto.
#   --solo-migrate    reconstruye ÚNICAMENTE la imagen de `migrate`. El sitio no
#                     se toca ni se cae. Es lo que hace falta cuando el cambio
#                     está en `scripts/` —el importador, el extractor— y no en
#                     la aplicación.
#
set -euo pipefail

cd "$(dirname "$0")/.."

SERVIDOR="${SERVIDOR_PROD:-astrion-srv}"
RUTA="/root/web_evoelution"
SITIO="${SITIO_PROD:-https://2-29-3-213.sslip.io}"
C="docker compose -f docker-compose.prod.yml --env-file deploy/.env"

solo_migrate=0
sin_preguntar=0
while [ $# -gt 0 ]; do
  case "$1" in
    --solo-migrate) solo_migrate=1 ;;
    --si|-y)        sin_preguntar=1 ;;
    -h|--help)      sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; exit 1 ;;
  esac
  shift
done

rama="$(git rev-parse --abbrev-ref HEAD)"

# ── Lo que no llega al servidor ──────────────────────────────────────────────
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "ABORTADO: tenés cambios sin commitear. El servidor despliega desde GitHub," >&2
  echo "así que esto NO viajaría:" >&2
  git status --short --untracked-files=no >&2
  exit 1
fi

git fetch --quiet origin "$rama"
if [ "$(git rev-parse HEAD)" != "$(git rev-parse "origin/$rama")" ]; then
  echo "ABORTADO: tu HEAD no coincide con origin/$rama. Hacé push primero." >&2
  exit 1
fi

# ── Qué va a cambiar allá ────────────────────────────────────────────────────
head_prod="$(ssh "$SERVIDOR" "cd $RUTA && git rev-parse HEAD")"
if [ "$head_prod" = "$(git rev-parse HEAD)" ]; then
  echo "▸ El servidor ya está en $(git rev-parse --short HEAD). No hay nada que desplegar."
  exit 0
fi

echo
echo "▸ Producción está en $(git rev-parse --short "$head_prod") y pasaría a $(git rev-parse --short HEAD):"
git --no-pager log --oneline "$head_prod..HEAD" | sed 's/^/    /'

# Si entre esos commits hay migraciones, se dice con todas las letras. Una
# migración es lo único de un despliegue que no se deshace con un `git revert`.
if git diff --name-only "$head_prod..HEAD" | grep -qE '^drizzle(-tenant)?/'; then
  echo
  echo "  ⚠ Este despliegue INCLUYE MIGRACIONES:"
  git diff --name-only "$head_prod..HEAD" | grep -E '^drizzle(-tenant)?/.*\.sql$' | sed 's/^/      /'
  echo "    ¿Las ensayaste contra una copia de producción?  scripts/sync-desde-prod.sh"
fi

if [ "$solo_migrate" = 1 ]; then
  echo
  echo "▸ Modo --solo-migrate: se reconstruye la imagen de scripts. El sitio NO se cae."
else
  echo
  echo "▸ Se reconstruye todo. El sitio queda abajo menos de un minuto."
fi

if [ "$sin_preguntar" = 0 ]; then
  # Sin terminal delante no hay a quién preguntar, y ahí un `read` recibe fin de
  # archivo al instante: se leería como un «no» y el script se iría diciendo
  # «Cancelado» sin que nadie haya cancelado nada. Pasó de verdad el 2026-08-26
  # —el despliegue se lanzó desde un contexto no interactivo y no llegó nada al
  # servidor— y el síntoma no se parecía a la causa.
  #
  # Tampoco se asume el sí: desplegar a producción sin que nadie lo confirme es
  # exactamente lo que la pregunta existe para evitar. Se dice qué pasó y cómo
  # seguir.
  if [ ! -t 0 ]; then
    echo
    echo "No hay terminal interactiva, así que no puedo preguntarte si seguimos." >&2
    echo "Corré esto en una Terminal de verdad, o repetilo con --si:" >&2
    echo "    npm run deploy:prod -- --si" >&2
    exit 2
  fi
  printf "\n¿Seguimos? [s/N] "
  read -r r
  # Se aceptan «y» e «yes» además de «s» y «sí»: el prompt dice [s/N] pero la
  # costumbre teclea «y», y rechazarlo obliga a repetir el despliegue entero
  # para descubrir que la respuesta estaba bien y el idioma mal.
  case "$r" in
    s|S|si|SI|Si|sí|Sí|SÍ|y|Y|yes|YES|Yes) ;;
    *) echo "Cancelado."; exit 1 ;;
  esac
fi

# ── Desplegar ────────────────────────────────────────────────────────────────
echo
echo "▸ Actualizando el checkout del servidor…"
ssh "$SERVIDOR" "cd $RUTA && git pull --ff-only origin $rama && git log --oneline -1"

if [ "$solo_migrate" = 1 ]; then
  echo "▸ Reconstruyendo la imagen de scripts…"
  ssh "$SERVIDOR" "cd $RUTA && $C build migrate"
  echo
  echo "✅ Imagen de scripts al día. La aplicación sigue como estaba."
  exit 0
fi

echo "▸ Reconstruyendo y levantando…"
# `migrate` corre antes que `web`, atado con `service_completed_successfully`:
# si una migración falla, `web` NO arranca y sigue sirviendo la versión vieja
# contra el esquema viejo, que es el estado correcto en el que quedarse.
ssh "$SERVIDOR" "cd $RUTA && $C up -d --build"

# ── nginx tiene que volver a buscar a `web` ──────────────────────────────────
#
# `upstream web_app { server web:3000; }` resuelve el nombre UNA vez, cuando
# nginx arranca, y nginx lleva semanas arriba. Al recrear `web` Docker le puede
# dar otra IP, y nginx sigue mandando a la vieja: 502 en todo el sitio con la
# aplicación sana. El `resolver` de la plantilla no lo evita: solo aplica a los
# `proxy_pass` con variables, y el de la aplicación no lo es.
#
# Pasó el 2026-09-11: el servicio nuevo `tipo-de-cambio` arrancó antes que
# `web` y se quedó con su IP (172.18.0.5); `web` salió en la .8. Minuto y medio
# de 502 hasta recargar nginx a mano. Recargar no corta conexiones ni reinicia
# el contenedor, y antes se comprueba la configuración para no tumbarlo.
ssh "$SERVIDOR" "cd $RUTA && $C exec -T nginx nginx -t -q && $C exec -T nginx nginx -s reload"

# ── Comprobar de verdad ──────────────────────────────────────────────────────
echo
echo "▸ Estado:"
ssh "$SERVIDOR" 'docker ps --format "    {{.Names}}  {{.Status}}"'

# Con reintentos: `web` tarda unos segundos en quedar listo después de `up`, y
# una sola consulta en ese hueco daba por fallido un despliegue sano.
codigo=000
for _ in $(seq 1 12); do
  codigo="$(curl -sS -o /dev/null -w '%{http_code}' -m 10 "$SITIO/api/health" || echo 000)"
  [ "$codigo" = "200" ] && break
  sleep 5
done
echo
if [ "$codigo" = "200" ]; then
  echo "✅ $SITIO responde 200. Desplegado $(git rev-parse --short HEAD)."
else
  echo "⚠ $SITIO/api/health respondió $codigo. Revisá:" >&2
  echo "    ssh $SERVIDOR 'cd $RUTA && $C logs --tail 50 web'" >&2
  exit 1
fi
