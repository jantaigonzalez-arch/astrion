#!/usr/bin/env bash
#
# Los probes que solo tienen sentido contra los DATOS REALES.
#
#   npm run probes:local
#
# Corren en tu máquina, contra la copia de producción que deja `sync:prod`, y
# NO están en el flujo de GitHub Actions. No es que valgan menos: es que su
# valor depende justamente de mirar datos de verdad —comprobar que ningún
# teléfono del padrón marca fuera de México solo significa algo si el padrón es
# el de verdad— y este repositorio es público, así que lo que imprimieran en un
# registro de Actions quedaría publicado.
#
# Cuándo correrlos: antes de desplegar, y sobre todo después de un `sync:prod`,
# que es cuando los datos cambian bajo los pies del código.
#
# El motivo de cada uno está en `pruebas/registro.ts`, en `SOLO_LOCAL`.
#
set -uo pipefail   # sin -e: si uno falla, los demás tienen que correr igual

cd "$(dirname "$0")/.."

# La lista sale del registro y no de aquí, para que no haya dos listas que
# mantener. Es el mismo motivo por el que `scripts/tenant.ts` deriva sus tablas
# de las migraciones en vez de enumerarlas.
#
# Se lee con `while read` y no con `mapfile`: `mapfile` es de bash 4 y macOS
# trae la 3.2, así que en la máquina donde más se va a usar este script no
# existe. El síntoma era «mapfile: command not found» seguido de dos variables
# sin definir.
PROBES=()
while IFS= read -r linea; do
  [ -n "$linea" ] && PROBES+=("$linea")
done < <(
  npx tsx --tsconfig tsconfig.check.json scripts/_solo-local.ts 2>/dev/null
)

if [ "${#PROBES[@]}" -eq 0 ]; then
  echo "No pude leer SOLO_LOCAL de pruebas/registro.ts" >&2
  exit 1
fi

fallos=0
for f in "${PROBES[@]}"; do
  printf '\n\033[1m── %s ──\033[0m\n' "$f"
  case "$f" in
    scripts/*) cmd=(npx tsx --tsconfig tsconfig.scripts.json "$f") ;;
    *)         cmd=(npx tsx --tsconfig tsconfig.check.json "$f") ;;
  esac
  if "${cmd[@]}"; then
    echo "✅ $f"
  else
    echo "❌ $f"
    fallos=$((fallos + 1))
  fi
done

echo
if [ "$fallos" -eq 0 ]; then
  echo "✅ los ${#PROBES[@]} probes locales pasan contra los datos de esta máquina."
else
  echo "❌ $fallos de ${#PROBES[@]} fallaron." >&2
  exit 1
fi
