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

echo "▸ Dominios: $APP_DOMAIN, www.$APP_DOMAIN, $ML_DOMAIN"
echo "▸ Verificá que los tres apunten por DNS (registro A) a la IP de este servidor."
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
