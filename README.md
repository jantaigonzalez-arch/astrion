# Evoelution — Sitio web + Portal

Nueva plataforma web de Evoelution: sitio corporativo bilingüe (ES/EN), panel de
administración y sistema de tickets de soporte. Construido con lo último del
ecosistema Next.

## Stack

- **Next.js 16** (App Router, React 19, Turbopack, Server Actions)
- **Tailwind CSS 4** + tokens OKLCH (modo claro/oscuro) + **Motion** (animaciones)
- **next-intl 4** — i18n español/inglés (`localePrefix: as-needed`, español por defecto)
- **Auth.js v5** (credenciales + JWT, roles: `admin` / `agent` / `client`)
- **Drizzle ORM** + **PostgreSQL**
- **Zod** para validación

## Arranque rápido

```bash
# 1. Node (una vez)
nvm install --lts && nvm use --lts

# 2. Dependencias
npm install

# 3. Variables de entorno
cp .env.example .env.local        # define DATABASE_URL y AUTH_SECRET
npx auth secret                   # genera AUTH_SECRET

# 4. Base de datos (requiere Postgres)
npm run db:push                   # crea las tablas desde el schema
npm run db:seed                   # datos demo + usuarios

# 5. Desarrollo
npm run dev                       # http://localhost:3000
```

> El sitio público y el login funcionan **sin** base de datos. El formulario de
> contacto degrada con elegancia (acepta el lead sin persistir) hasta configurar
> `DATABASE_URL`. El portal (dashboard/tickets/admin) requiere Postgres + seed.

### Usuarios demo (tras `db:seed`)

| Rol    | Correo                  | Contraseña   |
| ------ | ----------------------- | ------------ |
| Admin  | admin@evoelution.com    | `Admin123!`  |
| Agente | agente@evoelution.com   | `Agente123!` |
| Cliente| cliente@lab.com         | `Cliente123!`|

## Estructura

```
src/
├── app/[locale]/
│   ├── (marketing)/         # sitio público: home, nosotros, servicios,
│   │                        #   productos, marcas, contacto
│   └── (portal)/
│       ├── login/           # inicio de sesión
│       └── (app)/           # área autenticada (guard de sesión + sidebar)
│           ├── dashboard/   # resumen (cliente y staff)
│           ├── tickets/     # lista, nuevo, detalle + comentarios
│           └── admin/       # cola de tickets, leads, usuarios, catálogo
│                            #   (guard de rol: solo agent/admin)
├── components/
│   ├── marketing/           # hero, stats, servicios, cromatograma, etc.
│   ├── portal/              # sidebar, topbar, formularios, badges
│   ├── shared/              # logo, tema, switcher de idioma
│   └── ui/                  # primitivos (button, input, card, badge…)
├── lib/
│   ├── db/                  # schema Drizzle + cliente
│   ├── auth.ts              # Auth.js
│   ├── actions/             # server actions (leads, tickets)
│   ├── data/                # consultas (server-only)
│   └── tickets.ts           # constantes/labels/SLA (cliente+servidor)
├── i18n/                    # routing, request, navigation
└── messages/               # es.json, en.json
```

## Sistema de tickets

- Folio legible `EVO-000123`, categorías, prioridad y estados
  (`open → in_progress → waiting → resolved → closed`).
- **SLA de primera respuesta < 2 h** (según la promesa del sitio): se calcula
  `slaDueAt` al crear y se marca `firstRespondedAt` cuando responde el staff.
- Hilo de comentarios con **notas internas** (solo staff).
- El staff cambia estado y asigna; el cliente solo ve sus propios tickets.

## ML (fase 2)

Preparado, no conectado aún:
- `tickets.mlSuggested` (jsonb) — categoría/prioridad sugeridas + confianza.
- `leads.score` (int) — scoring de leads 0–100.
- `ML_SERVICE_URL` — microservicio FastAPI (reutiliza patrones de `evo_ai`)
  para clasificación de tickets, scoring y respuestas sugeridas.

## Scripts

| Comando            | Acción                                   |
| ------------------ | ---------------------------------------- |
| `npm run dev`      | Servidor de desarrollo                   |
| `npm run build`    | Build de producción                      |
| `npm run typecheck`| `tsc --noEmit`                           |
| `npm run db:push`  | Sincroniza el schema con la DB           |
| `npm run db:seed`  | Datos demo                               |
| `npm run db:studio`| Drizzle Studio (explorador de datos)     |
