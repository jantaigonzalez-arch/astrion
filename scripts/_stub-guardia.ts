/**
 * LA GUARDIA QUE PERMITE QUE LOS STUBS ESTÉN EN EL REPOSITORIO.
 *
 * ── QUÉ SE ESTABA EVITANDO ─────────────────────────────────────────────────
 *
 * Los stubs vivieron fuera de git a propósito, y la razón está escrita en el
 * `.gitignore`: «sustituyen la sesión y el contexto de inquilino, que es
 * exactamente lo que nadie debería importar por accidente desde la aplicación».
 *
 * No era paranoia. `_stub-tenancy` devuelve `role: "owner"` y un `puedeEn()`
 * que concede TODO sin mirar el módulo ni el nivel. Cargado dentro de la
 * aplicación, cualquiera sería dueño de cualquier empresa, y no habría ni un
 * error en el registro: el sistema seguiría funcionando, solo que sin permisos.
 * Un fallo que no se ve es el peor tipo de fallo que se puede versionar.
 *
 * ── POR QUÉ AHORA SÍ PUEDEN ENTRAR ─────────────────────────────────────────
 *
 * Porque tenerlos fuera tampoco salía gratis: catorce pruebas que pasan no
 * corren en el CI, `_probe-rendimiento` está versionado y no arranca en un clon
 * limpio, y las 137 acciones de servidor no tienen forma de probarse. Se pagaba
 * una cobertura entera por una protección que era, en el fondo, esconder el
 * archivo.
 *
 * Esta guardia cambia el trato: los stubs entran, y a cambio dejan de poder
 * fallar en silencio. Si alguno se carga donde no debe, el proceso muere en el
 * import con un mensaje que dice qué pasó — antes de atender una sola petición.
 * Un montaje roto y ruidoso es mejor que uno que funciona con los permisos
 * abiertos.
 *
 * ── LO QUE MIRA, Y POR QUÉ ESAS DOS SEÑALES ────────────────────────────────
 *
 * `NEXT_RUNTIME` la define el propio Next al arrancar su servidor, en `nodejs` o
 * en `edge`, tanto en desarrollo como en producción. Es la señal directa de
 * «esto se está cargando dentro de la aplicación», que es justo el caso temido.
 *
 * `NODE_ENV === "production"` cubre el resto: un script, una migración o
 * cualquier proceso del servidor. Ningún probe corre así —tsx deja `NODE_ENV`
 * sin definir y las pruebas lo ponen en `test`—, de modo que no hay caso
 * legítimo que esto estorbe.
 *
 * Las dos son negativas a propósito. Una comprobación positiva —exigir que el
 * probe declare una variable— obligaría a tocar las invocaciones de los catorce
 * y volvería a fallar el día que alguien escriba el probe quince sin leer esto.
 */

/**
 * Aborta si el stub se está cargando fuera de una prueba.
 *
 * Se llama en la primera línea ejecutable de cada `_stub-*.ts`, para que el
 * proceso muera en el import y no más tarde, cuando el daño ya dependa de qué
 * función se haya llamado.
 *
 * @param archivo  Nombre del stub, para que el mensaje diga cuál fue.
 * @param riesgo   Qué concede de más ese stub en concreto. Va en el mensaje
 *                 porque quien lo lea a las tres de la mañana necesita saber si
 *                 está ante un susto o ante un incidente de seguridad.
 */
export function soloEnPruebas(archivo: string, riesgo: string): void {
  const dentroDeNext = process.env.NEXT_RUNTIME;
  const enProduccion = process.env.NODE_ENV === "production";

  if (!dentroDeNext && !enProduccion) return;

  const donde = dentroDeNext
    ? `dentro del servidor de Next (NEXT_RUNTIME=${dentroDeNext})`
    : "en un proceso de producción (NODE_ENV=production)";

  throw new Error(
    `\n\n` +
      `  ${archivo} se cargó ${donde}.\n\n` +
      `  Es un SUSTITUTO PARA PRUEBAS y no debe llegar a la aplicación.\n` +
      `  ${riesgo}\n\n` +
      `  Solo se enruta desde \`tsconfig.probe.json\`, así que si aparece aquí es\n` +
      `  que algo de \`src/\` lo importa por ruta, o que ese tsconfig se coló en la\n` +
      `  construcción. Las dos cosas son fallos de montaje, no de pruebas.\n\n` +
      `  Hay una prueba sin base que vigila justamente esto:\n` +
      `      npm run test:unitarias\n`,
  );
}
