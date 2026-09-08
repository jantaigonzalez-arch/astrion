/**
 * QUÉ PRUEBA CORRE DÓNDE, Y POR QUÉ.
 *
 * Las cinco listas de este archivo reparten los 53 probes del repositorio. La
 * meta-prueba de `cobertura.test.ts` exige que TODOS estén exactamente en una:
 * un probe nuevo que nadie clasifique rompe la suite en vez de quedarse fuera
 * en silencio, que es como se llega a tener catorce pruebas muertas sin que
 * nadie se entere.
 *
 * ── LO QUE DECIDE EN QUÉ LISTA CAE CADA UNO ────────────────────────────────
 *
 * No es una opinión sobre su calidad: es si puede dar verde o rojo por sí solo
 * contra una base recién sembrada. Se comprobó corriéndolos todos, no leyéndolos.
 *
 * ── POR QUÉ EL CI NO TOCA LOS DATOS REALES ─────────────────────────────────
 *
 * Porque este repositorio es PÚBLICO y los registros de Actions también. Un
 * probe que imprima el nombre de un cliente o el importe de un contrato lo
 * publica en internet. `SOLO_LOCAL` no es una lista de segunda: es donde viven
 * las pruebas cuyo valor depende de mirar datos de verdad, y por eso mismo no
 * pueden correr en un servidor ajeno.
 */

/**
 * Sin base de datos. Segundos, y ninguna infraestructura.
 *
 * Leen el código fuente y las hojas de estilo, o ejercitan funciones puras.
 * Son la primera línea: si algo de aquí se pone rojo, no hace falta ni levantar
 * Postgres para saber que el PR está mal.
 */
export const UNITARIAS = [
  "probe-beta.mts",
  "probe-formularios.mts",
  "probe-permisos.mts",
  "probe-revision.mts",
  "probe-rutas.mts",
  "probe-selector.mts",
  "probe-suscripcion.mts",
  "probe-tablas.mts",
] as const;

/**
 * Contra la base sembrada por `scripts/base-de-pruebas.sh`.
 *
 * Aquí están las que de verdad ejercitan el producto: el ciclo de una factura,
 * el aislamiento entre empresas, quién recibe qué aviso, que borrar un
 * entrenamiento no se lleve por delante lo que no debe.
 */
export const INTEGRACION = [
  "probe-avisos.mts",
  "probe-borrar-modelos.mts",
  "probe-campana.mts",
  "probe-e2e.mts",
  "probe-equipos.mts",
  "probe-payables.mts",
  "probe-permisos-db.mts",
  "probe-series.mts",
  "probe-sla.mts",
  "probe-unapply.mts",
  "probe-viaticos.mts",
  "scripts/_probe-budget.ts",
  "scripts/_probe-clientes.ts",
] as const;

/**
 * Corren a mano contra la copia de producción. NUNCA en CI.
 *
 * Su valor está justamente en los datos reales, así que sembrarlos los vacía de
 * sentido: comprobar que ningún teléfono del padrón marca fuera de México solo
 * significa algo si el padrón es el de verdad.
 *
 *   npm run probes:local
 */
export const SOLO_LOCAL: Record<string, string> = {
  "probe-telefono.mts":
    "Formatea los teléfonos que hay cargados. Los sembrados empiezan por 47 y " +
    "el formateador los lee como Noruega: el rojo sería del generador, no del código.",
  "probe-domicilio.mts":
    "Desarma las direcciones reales y rescata el código postal de 143 de ellas. " +
    "La siembra no genera domicilios con CP, así que aquí no hay nada que rescatar.",
  "probe-export.mts":
    "Compara la descarga contra los tickets cargados, incluido que un filtro de " +
    "estado recorte de verdad. Con la siembra no hay reparto de estados que recortar.",
  "probe-folios.mts":
    "Exige que una consulta sin inquilino FALLE. En una base recién aprovisionada " +
    "las tablas de negocio siguen en `public` —a producción llegaron con `adopt`, " +
    "que las movió al esquema—, así que la consulta responde y el probe reprueba " +
    "por una diferencia de entorno, no del código.",
  "scripts/_probe-perf.ts":
    "Mide tiempos contra el volumen real. Un umbral de rendimiento en un " +
    "ejecutor compartido de CI es una prueba que falla los martes.",
};

/**
 * ROTAS. Deuda declarada, a la vista y no disimulada.
 *
 * Las catorce revientan al arrancar, y no por culpa de la base: lo hacen igual
 * contra la de desarrollo. Todas por lo mismo — llaman a `tenantDb()`, que
 * exige el contexto de una petición de Next (`headers()`), y fuera de un
 * servidor ese contexto no existe. Se escribieron cuando esa llamada aún
 * funcionaba suelta y nadie las volvió a correr desde entonces.
 *
 * Están aquí y no borradas porque el criterio que contienen sigue siendo bueno:
 * rescatarlas es darles una conexión explícita, como ya hicieron las funciones
 * de datos para la capa de extracción. Mientras tanto NO corren, y esta lista
 * es el recordatorio de que no lo hacen.
 */
export const ROTAS: Record<string, string> = Object.fromEntries(
  [
    "probe-roles.mts",
    "scripts/_probe-arq.ts",
    "scripts/_probe-arreglos.ts",
    "scripts/_probe-borrar.ts",
    "scripts/_probe-busqueda.ts",
    "scripts/_probe-contratos.ts",
    "scripts/_probe-goals.ts",
    "scripts/_probe-huerfanos.ts",
    "scripts/_probe-listas.ts",
    "scripts/_probe-nuevo.ts",
    "scripts/_probe-profit.ts",
    "scripts/_probe-rent.ts",
    "scripts/_probe-siembra.ts",
  ].map((f) => [f, "Revienta: llama a `tenantDb()` fuera del contexto de una petición."]),
);

/**
 * DIAGNÓSTICO. Miden e informan; no afirman nada.
 *
 * Imprimen tiempos, cuentan sentencias, vuelcan el estado de una tabla. Son
 * herramientas útiles —`_probe-repetidas` encontró consultas duplicadas de
 * verdad— pero no tienen aserciones, así que en CI serían verde eterno. Un
 * verde que no puede ponerse rojo enseña al equipo a no mirar el tablero.
 */
export const DIAGNOSTICO: Record<string, string> = Object.fromEntries(
  [
    "probe-acceso-local.mts",
    "probe-compras.mts",
    "scripts/_probe-arch.ts",
    "scripts/_probe-conteos.ts",
    "scripts/_probe-dash.ts",
    "scripts/_probe-formas.ts",
    "scripts/_probe-layout.ts",
    "scripts/_probe-nuevos.ts",
    "scripts/_probe-pantallas.ts",
    "scripts/_probe-permisos-tablero.ts",
    "scripts/_probe-repetidas.ts",
    "scripts/_probe-tableros.ts",
    "scripts/_probe-usuario-general.ts",
    "scripts/_probe-viaticos-perf.ts",
  ].map((f) => [f, "Informe sin aserciones: mide y reporta, no puede reprobar."]),
);

/** Todo lo clasificado, para que la meta-prueba compruebe que no falta ninguno. */
export const CLASIFICADOS = new Set<string>([
  ...UNITARIAS,
  ...INTEGRACION,
  ...Object.keys(SOLO_LOCAL),
  ...Object.keys(ROTAS),
  ...Object.keys(DIAGNOSTICO),
]);
