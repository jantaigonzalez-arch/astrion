#!/usr/bin/env bash
#
# Emisión inicial de certificados TLS. Se corre UNA vez, al montar el
# servidor. Después el servicio `certbot` del compose renueva solo.
#
# El problema que resuelve: nginx no arranca sin un certificado, y certbot no
# puede emitir uno sin nginx arriba respondiendo el desafío ACME. La salida es
# crear un certificado autofirmado temporal, levantar nginx con él, pedir el
# real, y recargar.
#
# Uso (desde la raíz del repo, en el servidor):
#   ./deploy/init-letsencrypt.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.prod.yml --env-file deploy/.env"

if [[ ! -f deploy/.env ]]; then
  echo "✗ Falta deploy/.env — copialo de deploy/.env.example y completalo." >&2
  exit 1
fi
# shellcheck disable=SC1091
set -a; source deploy/.env; set +a

: "${APP_DOMAIN:?definí APP_DOMAIN en deploy/.env}"
: "${LETSENCRYPT_EMAIL:?definí LETSENCRYPT_EMAIL en deploy/.env}"
# Sin default global a propósito: cada modo pone el suyo. En modo sslip, un
# `cromatografia.evoelution.com` heredado NO resuelve a este servidor, y basta
# un nombre que no resuelva para que Let's Encrypt rechace el certificado
# ENTERO — incluidos los nombres que sí estaban bien.
ML_DOMAIN="${ML_DOMAIN:-}"

# --staging usa el entorno de pruebas de Let's Encrypt: certificados no
# confiables por el navegador, pero sin límite de intentos. Conviene para el
# primer ensayo — el límite real es de 5 emisiones por dominio por semana, y
# se agota rápido depurando DNS.
STAGING_FLAG=""
AGREGAR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --staging)
      STAGING_FLAG="--staging"
      echo "▸ Modo STAGING: los certificados NO serán válidos en el navegador."
      ;;
    --agregar)
      # Mete una empresa más en el certificado. Solo tiene sentido en modo
      # sslip: es el precio de no tener comodín.
      AGREGAR="${2:?uso: --agregar <slug-de-la-empresa>}"
      shift
      ;;
    *)
      echo "✗ Opción desconocida: $1" >&2
      echo "  uso: $0 [--staging] [--agregar <slug>]" >&2
      exit 1
      ;;
  esac
  shift
done

# El modo decide qué certificados hacen falta. nginx NO arranca si referencia
# uno que no existe, así que emitir de menos tumba el sitio entero — que es
# exactamente lo que pasaba antes: la plantilla de multiempresa pedía el
# certificado de ROOT_DOMAIN y este script nunca lo emitía.
NGINX_TEMPLATES="${NGINX_TEMPLATES:-una-empresa}"

# El certificado se llama como su PRIMER nombre y vive en
# /etc/letsencrypt/live/<ese nombre>/. Las plantillas de nginx apuntan ahí, así
# que esto tiene que coincidir con lo que espera la plantilla del modo.
CERT_NAME="$APP_DOMAIN"
DOMINIOS=()

if [[ "$NGINX_TEMPLATES" == "sslip" ]]; then
  : "${ROOT_DOMAIN:?en modo sslip, ROOT_DOMAIN es el host de la IP (5-75-1-2.sslip.io)}"
  # La plantilla de sslip referencia live/${ROOT_DOMAIN}: el certificado se
  # llama como el apex y lleva dentro el host de cada empresa.
  CERT_NAME="$ROOT_DOMAIN"
  ML_DOMAIN="${ML_DOMAIN:-cromatografia.$ROOT_DOMAIN}"
  DOMINIOS=("$ROOT_DOMAIN" "www.$ROOT_DOMAIN" "$ML_DOMAIN")

  # Las empresas, que en este modo NO las cubre un comodín: cada una entra por
  # su nombre. `--agregar` suma una sin tener que editar deploy/.env primero.
  [[ -n "$AGREGAR" ]] && TENANT_SLUGS="${TENANT_SLUGS:-},$AGREGAR"
  IFS=',' read -ra SLUGS <<< "${TENANT_SLUGS:-}"
  for slug in "${SLUGS[@]}"; do
    slug="$(echo "$slug" | tr -d '[:space:]')"
    [[ -z "$slug" ]] && continue
    DOMINIOS+=("$slug.$ROOT_DOMAIN")
  done

  echo "▸ Modo SSLIP (subdominios reales, sin dominio propio)."
  echo "  UN certificado con todos estos nombres:"
  printf '    · %s\n' "${DOMINIOS[@]}"
  echo
  echo "  Dar de alta otra empresa exige volver a correr esto con"
  echo "  --agregar <slug>: sin comodín, su nombre tiene que entrar aquí."
elif [[ "$NGINX_TEMPLATES" == "multiempresa" ]]; then
  : "${ROOT_DOMAIN:?en modo multiempresa hay que definir ROOT_DOMAIN en deploy/.env}"
  ML_DOMAIN="${ML_DOMAIN:-cromatografia.$APP_DOMAIN}"
  DOMINIOS=("$APP_DOMAIN" "www.$APP_DOMAIN" "$ML_DOMAIN")
  echo "▸ Modo MULTIEMPRESA."
  echo "  Certificado 1 (este script):  $APP_DOMAIN, www.$APP_DOMAIN, $ML_DOMAIN"
  echo "  Certificado 2 (comodín):      $ROOT_DOMAIN y *.$ROOT_DOMAIN"
  echo
  echo "  El comodín NO se puede emitir por HTTP: Let's Encrypt solo valida"
  echo "  *.dominio por DNS. Este script emite el primero; el segundo lo tenés"
  echo "  que pedir con el complemento DNS de tu proveedor. Al final te digo cómo."
else
  ML_DOMAIN="${ML_DOMAIN:-cromatografia.$APP_DOMAIN}"
  DOMINIOS=("$APP_DOMAIN" "www.$APP_DOMAIN" "$ML_DOMAIN")
  echo "▸ Modo UNA EMPRESA (sin comodín)."
  echo "  Certificado: ${DOMINIOS[*]}"
fi

if [[ -n "$AGREGAR" && "$NGINX_TEMPLATES" != "sslip" ]]; then
  echo "✗ --agregar solo aplica al modo sslip. En multiempresa el comodín ya"
  echo "  cubre a cualquier empresa nueva sin reemitir nada." >&2
  exit 1
fi
echo
echo "▸ Verificá que esos nombres apunten por DNS (registro A) a la IP de este servidor."
read -rp "  ¿Continuar? [s/N] " ok
[[ "$ok" =~ ^[sSyY]$ ]] || { echo "Cancelado."; exit 0; }

LIVE="/etc/letsencrypt/live/$CERT_NAME"

# `-d nombre` por cada nombre del certificado. El PRIMERO decide cómo se llama
# el certificado y, por tanto, la carpeta que referencian las plantillas.
D_FLAGS=""
for d in "${DOMINIOS[@]}"; do D_FLAGS="$D_FLAGS -d $d"; done

# Añadir un nombre a un certificado que ya existe es EXPANDIRLO, y certbot no
# lo hace solo: sin esto pediría confirmación por consola y, en modo
# desatendido, aborta. Solo hace falta donde la lista crece —el modo sslip, que
# suma una empresa cada vez— y por eso no se pone en los otros: ahí un cambio
# inesperado de la lista es una señal de que algo está mal configurado.
EXPAND_FLAG=""
[[ "$NGINX_TEMPLATES" == "sslip" ]] && EXPAND_FLAG="--expand"

# ¿Ya hay un certificado DE VERDAD para este nombre?
#
# Lo decide `renewal/<nombre>.conf`, que certbot escribe al emitir y el
# autofirmado nunca crea. La distinción es lo que separa dos operaciones que se
# parecen y no son la misma:
#
#   primera vez     no hay nada → autofirmado temporal → emitir
#   --agregar       ya hay uno bueno → NO tocarlo → expandirlo
#
# Sin esto, agregar una empresa borraba el certificado vigente para volver a
# pedirlo de cero: gasta una de las cinco emisiones semanales que permite Let's
# Encrypt, y deja al servidor sin certificado en disco mientras tanto. nginx
# sobrevive porque conserva en memoria el que ya cargó, pero cualquier reinicio
# en esa ventana lo deja sin arrancar.
YA_HAY_CERT=""
if $COMPOSE run --rm --entrypoint \
    "sh -c 'test -f /etc/letsencrypt/renewal/$CERT_NAME.conf'" certbot >/dev/null 2>&1; then
  YA_HAY_CERT="1"
fi

if [[ -z "$YA_HAY_CERT" ]]; then
  echo "▸ 1/4 Certificado temporal autofirmado (para que nginx pueda arrancar)…"
  $COMPOSE run --rm --entrypoint "sh -c '
    mkdir -p $LIVE &&
    openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
      -keyout $LIVE/privkey.pem -out $LIVE/fullchain.pem -subj \"/CN=localhost\"
  '" certbot
else
  echo "▸ 1/4 Ya hay un certificado emitido para $CERT_NAME: se conserva."
fi

echo "▸ 2/4 Levantando nginx…"
$COMPOSE up -d nginx
sleep 5

if [[ -z "$YA_HAY_CERT" ]]; then
  echo "▸ 3/4 Descartando el temporal y pidiendo el real…"
  $COMPOSE run --rm --entrypoint "rm -rf /etc/letsencrypt/live/$CERT_NAME /etc/letsencrypt/archive/$CERT_NAME /etc/letsencrypt/renewal/$CERT_NAME.conf" certbot
else
  echo "▸ 3/4 Expandiendo el certificado existente con los nombres nuevos…"
fi

# Un solo certificado con los tres nombres (SAN). Por eso los server blocks
# del subdominio apuntan al mismo archivo que el dominio principal.
$COMPOSE run --rm --entrypoint "\
  certbot certonly --webroot -w /var/www/certbot \
    $STAGING_FLAG \
    $D_FLAGS $EXPAND_FLAG \
    --email $LETSENCRYPT_EMAIL \
    --agree-tos --no-eff-email --non-interactive --keep-until-expiring" certbot

echo "▸ 4/4 Recargando nginx con el certificado definitivo…"
$COMPOSE exec nginx nginx -s reload

echo
echo "✅ Listo. https://$CERT_NAME"
echo "   La renovación queda a cargo del servicio 'certbot' (revisa cada 12 h)."

if [[ "$NGINX_TEMPLATES" == "multiempresa" ]]; then
  cat <<FIN

⚠️  FALTA EL COMODÍN. nginx no va a arrancar con la plantilla de multiempresa
   hasta que exista /etc/letsencrypt/live/$ROOT_DOMAIN/.

   Necesitás el complemento DNS de tu proveedor y un token de su API. Con
   Cloudflare, por ejemplo:

     1. Guardá el token en el volumen de certbot:
        docker compose -f docker-compose.prod.yml --env-file deploy/.env \
          run --rm --entrypoint "sh -c 'echo dns_cloudflare_api_token=TU_TOKEN \
          > /etc/letsencrypt/cloudflare.ini && chmod 600 /etc/letsencrypt/cloudflare.ini'" certbot

     2. Emitilo:
        docker compose -f docker-compose.prod.yml --env-file deploy/.env \
          run --rm --entrypoint "certbot certonly --dns-cloudflare \
            --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
            -d $ROOT_DOMAIN -d '*.$ROOT_DOMAIN' \
            --email $LETSENCRYPT_EMAIL --agree-tos --no-eff-email --non-interactive" certbot

     3. Recargá nginx:
        docker compose -f docker-compose.prod.yml --env-file deploy/.env exec nginx nginx -s reload

   La imagen certbot/certbot ya trae el complemento de Cloudflare. Para otro
   proveedor, cambiá --dns-cloudflare por el suyo.

   El bucle de renovación recoge este certificado igual que los demás:
   'certbot renew' recuerda con qué complemento se emitió cada uno.
FIN
fi
