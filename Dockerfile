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

# ---------- migrator: aplica migraciones antes de arrancar la app ----------
# Necesita node_modules completo (drizzle-kit es devDependency) y el schema.
FROM node:22-alpine AS migrator
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json drizzle.config.ts ./
COPY drizzle ./drizzle
COPY src/lib/db ./src/lib/db
COPY tsconfig.json ./
# `migrate` aplica los .sql versionados y registra cuáles ya corrieron.
# NUNCA usar `db:push` en producción: sincroniza el schema por diferencia,
# sin historial ni control de qué hace, y puede descartar datos.
CMD ["npx", "drizzle-kit", "migrate"]

# ---------- runner: lo mínimo para servir ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

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
