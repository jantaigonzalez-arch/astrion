#!/usr/bin/env bash
#
# Levanta DESDE CERO la base contra la que corren las pruebas de integración.
#
#   DATABASE_URL=postgresql://…/evoelution_ci scripts/base-de-pruebas.sh
#
# La usan dos sitios y a propósito el mismo script: GitHub Actions en cada PR, y
# cualquiera que quiera reproducir el CI en su máquina. Si divergieran, «en mi
# máquina pasa» dejaría de ser una afirmación comprobable.
#
# ── POR QUÉ SE SIEMBRA Y NO SE COPIA PRODUCCIÓN ──────────────────────────────
#
# Porque este repositorio es PÚBLICO y los registros de Actions también. Una
# prueba que imprima el nombre de un cliente, un RFC o el importe de un contrato
# lo publica en internet sin que nadie lo note. `seed-synthetic` genera una
# empresa entera —diez años, catorce mil tickets— que no tiene un solo dato real
# dentro, así que no hay nada que se pueda filtrar.
#
# ── POR QUÉ EL INQUILINO SE LLAMA «evoelution» ───────────────────────────────
#
# Porque veinte probes escriben `tenant_evoelution` en su código. Nombrar igual
# al inquilino sembrado los deja correr sin tocarles una línea; la alternativa
# era una variable de entorno en cincuenta y tres archivos, que es mucho cambio
# para no ganar nada. Aquí dentro no hay ambigüedad posible: esta base se crea
# vacía cada vez.
#
set -euo pipefail

cd "$(dirname "$0")/.."

: "${DATABASE_URL:?Hace falta DATABASE_URL apuntando a la base de PRUEBAS}"

# ── La guardia ───────────────────────────────────────────────────────────────
#
# Lo primero que hace este script es DROP DATABASE. Con la URL de `.env.local`
# —que en esta máquina es una copia de producción con clientes reales— eso
# borraría el trabajo de una sincronización entera, y `sync:prod` va en un solo
# sentido: no hay desde dónde recuperarlo.
#
# Por eso el nombre de la base tiene que decir a las claras que es de pruebas.
# No es una molestia: es la diferencia entre un comando mal tecleado y una tarde
# perdida.
base="${DATABASE_URL##*/}"
# `[?]` como clase y no como signo escapado: escapado, bash lo confunde con la
# expansión de «error si no está definida» y aborta con «unbound variable».
base="${base%%[?]*}"
case "$base" in
  *_ci | *_test | *_pruebas | *_prueba) ;;
  *)
    echo "ABORTADO: «${base}» no parece una base de pruebas." >&2
    echo "Este script BORRA la base que se le indique, y aquí la de desarrollo" >&2
    echo "es una copia de producción con datos de clientes reales." >&2
    echo "El nombre debe terminar en _ci, _test, _pruebas o _prueba." >&2
    exit 1
    ;;
esac

servidor="${DATABASE_URL%/*}"

echo "▸ Recreando «${base}»…"
psql "$servidor/postgres" -q -c "DROP DATABASE IF EXISTS $base" >/dev/null
psql "$servidor/postgres" -q -c "CREATE DATABASE $base" >/dev/null

echo "▸ Migraciones de plataforma…"
npx drizzle-kit migrate 2>&1 | grep -E "applied|error|Error" || true

# Tres inquilinos porque tres hacen falta: `evoelution` es contra el que corre
# casi todo, y `bajio` y `acme` los nombran los probes que comprueban justamente
# que un inquilino no ve lo del otro. Con uno solo, ese aislamiento no se podría
# probar — que es la propiedad más importante de un producto multiempresa.
# El NOMBRE de cada uno tiene que empezar por letras distintas, no es adorno: el
# prefijo de folio se deriva del nombre, así que llamarlos «Pruebas evoelution» y
# «Pruebas acme» les daba a los tres el mismo prefijo `PRU` — y `probe-folios`,
# que comprueba justamente que cada empresa marque sus folios con el suyo,
# reprobaba por culpa de la siembra y no del código.
provisionar() {
  echo "▸ Inquilino «${1}»…"
  npx tsx scripts/tenant.ts provision --slug "$1" --name "$2" \
    2>&1 | grep -E "creado|ABORT|Error" || true
}
provisionar evoelution "Evoelution"
provisionar bajio      "Bajio Servicios"
provisionar acme       "ACME Laboratorios"

echo "▸ Sembrando diez años de historia en «evoelution»…"
npx tsx --tsconfig tsconfig.scripts.json scripts/seed-synthetic.ts --slug evoelution \
  2>&1 | tail -4

echo
echo "✅ Base de pruebas lista en «${base}»."
