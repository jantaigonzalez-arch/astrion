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
ML_DOMAIN="${ML_DOMAIN:-cromatografia.evoelution.com}"

# --staging usa el entorno de pruebas de Let's Encrypt: certificados no
# confiables por el navegador, pero sin límite de intentos. Conviene para el
# primer ensayo — el límite real es de 5 emisiones por dominio por semana, y
# se agota rápido depurando DNS.
STAGING_FLAG=""
if [[ "${1:-}" == "--staging" ]]; then
  STAGING_FLAG="--staging"
  echo "▸ Modo STAGING: los certificados NO serán válidos en el navegador."
fi

# El modo decide qué certificados hacen falta. nginx NO arranca si referencia
# uno que no existe, así que emitir de menos tumba el sitio entero — que es
# exactamente lo que pasaba antes: la plantilla de multiempresa pedía el
# certificado de ROOT_DOMAIN y este script nunca lo emitía.
NGINX_TEMPLATES="${NGINX_TEMPLATES:-una-empresa}"

if [[ "$NGINX_TEMPLATES" == "multiempresa" ]]; then
  : "${ROOT_DOMAIN:?en modo multiempresa hay que definir ROOT_DOMAIN en deploy/.env}"
  echo "▸ Modo MULTIEMPRESA."
  echo "  Certificado 1 (este script):  $APP_DOMAIN, www.$APP_DOMAIN, $ML_DOMAIN"
  echo "  Certificado 2 (comodín):      $ROOT_DOMAIN y *.$ROOT_DOMAIN"
  echo
  echo "  El comodín NO se puede emitir por HTTP: Let's Encrypt solo valida"
  echo "  *.dominio por DNS. Este script emite el primero; el segundo lo tenés"
  echo "  que pedir con el complemento DNS de tu proveedor. Al final te digo cómo."
else
  echo "▸ Modo UNA EMPRESA (sin comodín)."
  echo "  Certificado: $APP_DOMAIN, www.$APP_DOMAIN, $ML_DOMAIN"
fi
echo
echo "▸ Verificá que esos nombres apunten por DNS (registro A) a la IP de este servidor."
read -rp "  ¿Continuar? [s/N] " ok
[[ "$ok" =~ ^[sSyY]$ ]] || { echo "Cancelado."; exit 0; }

LIVE="/etc/letsencrypt/live/$APP_DOMAIN"

echo "▸ 1/4 Certificado temporal autofirmado (para que nginx pueda arrancar)…"
$COMPOSE run --rm --entrypoint "sh -c '
  mkdir -p $LIVE &&
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout $LIVE/privkey.pem -out $LIVE/fullchain.pem -subj \"/CN=localhost\"
'" certbot

echo "▸ 2/4 Levantando nginx…"
$COMPOSE up -d nginx
sleep 5

echo "▸ 3/4 Descartando el temporal y pidiendo el real…"
$COMPOSE run --rm --entrypoint "rm -rf /etc/letsencrypt/live/$APP_DOMAIN /etc/letsencrypt/archive/$APP_DOMAIN /etc/letsencrypt/renewal/$APP_DOMAIN.conf" certbot

# Un solo certificado con los tres nombres (SAN). Por eso los server blocks
# del subdominio apuntan al mismo archivo que el dominio principal.
$COMPOSE run --rm --entrypoint "\
  certbot certonly --webroot -w /var/www/certbot \
    $STAGING_FLAG \
    -d $APP_DOMAIN -d www.$APP_DOMAIN -d $ML_DOMAIN \
    --email $LETSENCRYPT_EMAIL \
    --agree-tos --no-eff-email --non-interactive --keep-until-expiring" certbot

echo "▸ 4/4 Recargando nginx con el certificado definitivo…"
$COMPOSE exec nginx nginx -s reload

echo
echo "✅ Listo. https://$APP_DOMAIN"
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
