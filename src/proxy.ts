// Convención `proxy` de Next 16. Reemplaza a `middleware`, que quedó
// deprecada: mismo contrato (export default + config.matcher), solo cambia
// el nombre del archivo.
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Aplica i18n a todo excepto API, estáticos y archivos con extensión.
  // Las fotos subidas (/uploads/*.jpg) entran por la regla de extensión; en
  // producción ni siquiera llegan aquí: las sirve nginx desde el volumen.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
