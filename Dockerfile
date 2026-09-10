# Imagen de producción de web_evoelution.
# Sigue el mismo patrón multi-stage que evo_ai/frontend, más un stage extra
# para correr las migraciones (que el runner standalone no puede: no lleva
# drizzle-kit ni el resto de devDependencies).

# ---------- deps: dependencias completas, cacheadas por el lockfile ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- builder: compila la app ----------
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# El build de Next evalúa módulos que leen process.env. DATABASE_URL no se
# usa en build (getDb() es perezoso), pero se define para que ninguna
# evaluación de módulo falle por su ausencia. No es la credencial real: la de
# runtime llega por el entorno del contenedor.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV AUTH_SECRET="build-time-placeholder-not-used-at-runtime"
RUN npm run build

# ---------- migrator: migraciones y administración de empresas ----------
# Necesita node_modules completo (drizzle-kit y tsx son devDependencies).
#
# Lleva DOS juegos de migraciones y las herramientas para operarlas, porque son
# dos planos distintos:
#
#   drizzle/         plano de control en `public` — tenants, users, memberships
#   drizzle-tenant/  tablas de negocio, replicadas en el esquema de CADA empresa
#
# Antes esta imagen solo llevaba el primero, y por eso un servidor recién
# montado quedaba sin salida: se creaba el plano de control, pero no había
# forma de aprovisionar la primera empresa —ni `scripts/tenant.ts`, ni las
# migraciones de negocio— así que el seed fallaba y la app no tenía qué servir.
FROM node:22-alpine AS migrator
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json drizzle.config.ts drizzle.tenant.config.ts ./
COPY drizzle ./drizzle
COPY drizzle-tenant ./drizzle-tenant
COPY scripts ./scripts
# Los catálogos del SAT, versionados y comprimidos (1,8 MB los siete).
#
# Van EN LA IMAGEN a propósito. La alternativa era copiarlos al servidor a mano
# cada vez, y entonces «¿contra qué versión del catálogo validó producción?» no
# tendría respuesta dentro del sistema. Aquí la contesta git, y el cargador
# guarda además el sha256 de cada archivo en `sat_catalogo`.
#
# Solo entran en ESTA imagen, no en la de la aplicación: los lee un script que
# se corre a mano dos veces al año, no una petición.
COPY datos ./datos
# `src` entero y no solo `lib/db`: el aprovisionamiento importa el contexto de
# inquilino, el esquema de negocio y el dominio (folios, eventos).
COPY src ./src
# `migrate` aplica los .sql versionados y registra cuáles ya corrieron.
# NUNCA usar `db:push` en producción: sincroniza el schema por diferencia,
# sin historial ni control de qué hace, y puede descartar datos.
#
# Solo el plano de control. Las de negocio las aplica `scripts/tenant.ts
# migrate` a cada esquema, porque hay que recorrer uno por empresa.
# LAS DOS MITADES DEL ESQUEMA, EN ORDEN.
#
# `drizzle-kit migrate` aplica SOLO el plano de control (`drizzle/`): tenants,
# users, memberships. Las tablas de negocio viven en `tenant_<slug>` y las lleva
# `drizzle-tenant/`, que este contenedor nunca corría — se aplicaban a mano y
# nadie lo recordaba, porque hasta ahora ninguna migración de inquilino había
# llegado junto a código que la necesitara el mismo día.
#
# La primera que lo hizo habría tumbado el portal entero: la aplicación consulta
# la tabla nueva en el layout de todas las pantallas, así que sin ella cada
# página responde 500 para todos los clientes a la vez.
#
# En serie con `&&`, y en este orden: el plano de control primero porque
# `tenant_schemas` —de donde sale la lista de esquemas a migrar— vive ahí. Si
# cualquiera de las dos falla, el contenedor sale con error y `web` NO arranca:
# sigue sirviendo la versión vieja contra el esquema viejo, que es el estado
# correcto en el que quedarse. Ver `depends_on` en docker-compose.prod.yml.
#
# `scripts/tenant.ts migrate` es idempotente: lleva en `tenant_schemas` cuál fue
# la última aplicada a cada esquema y solo corre lo que falte. Correrlo en cada
# despliegue no cuesta nada cuando no hay pendientes.
CMD ["sh", "-c", "npx drizzle-kit migrate && npx tsx scripts/tenant.ts migrate"]

# ---------- runner: lo mínimo para servir ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Zona horaria de la operación, no del centro de datos.
#
# Un contenedor sin `TZ` corre en UTC, y eso no es un detalle cosmético: las
# actividades del CRM se capturan con `datetime-local` —un texto SIN zona, como
# "2026-08-14T09:00"— y `new Date()` lo interpreta en la zona del SERVIDOR. Con
# UTC, un seguimiento agendado a las 9:00 de la mañana queda a las 3:00 de la
# madrugada. En desarrollo no se ve, porque la máquina de quien programa ya está
# en horario de México: es un fallo que solo aparece después de desplegar.
#
# `tzdata` hace falta en alpine: sin el paquete, `TZ` se ignora en silencio y el
# contenedor sigue en UTC creyendo que obedeció.
#
# Se puede cambiar por empresa el día que haya clientes en otro huso; hoy toda
# la operación es de México y una constante explícita vale más que un valor por
# omisión que nadie eligió.
ENV TZ=America/Mexico_City
RUN apk add --no-cache tzdata

# Usuario sin privilegios: si alguien logra ejecución remota, no es root.
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Punto de montaje del volumen de fotos. Vive FUERA de la app: `public/` se
# reconstruye en cada imagen, así que lo que se guardara ahí desaparecería en
# el siguiente deploy. nginx sirve este mismo volumen en /uploads/.
RUN mkdir -p /data/uploads && chown -R nextjs:nodejs /data
ENV UPLOADS_DIR=/data/uploads

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
