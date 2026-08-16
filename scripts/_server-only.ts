/**
 * Relleno de `server-only` para los scripts.
 *
 * `server-only` no es un paquete instalado: lo resuelve el compilador de Next
 * para hacer fallar el build si un módulo de servidor acaba en el bundle del
 * cliente. Fuera de Next no existe, y por eso cualquier script que importe
 * `lib/domain/*` —que empieza con `import "server-only"`— revienta al arrancar.
 *
 * Con esto, el dominio se puede ejercitar desde `tsx` y probar contra una base
 * real. Se enchufa por `tsconfig.scripts.json`, no por `tsconfig.json`: en el
 * build de la aplicación la protección tiene que seguir siendo la de verdad.
 */
export {};
