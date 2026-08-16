import { PageSkeleton } from "@/components/portal/skeletons";

/**
 * Estado de carga de TODO el portal.
 *
 * Puesto en `(app)` y no en cada pantalla: envuelve al `page.tsx` de este
 * segmento y a todos los de abajo en un `<Suspense>`, así que una sola pieza
 * cubre las ~40 rutas del ERP. Las pantallas que merecen un esqueleto más
 * fiel al suyo declaran el propio `loading.tsx` en su carpeta y este cede.
 *
 * Lo que arregla: sin él, al pulsar un enlace del menú el navegador se quedaba
 * en la pantalla ANTERIOR hasta que la última consulta terminaba —sin barra,
 * sin esqueleto, sin nada—. En local son 40 ms y no se nota; con la latencia de
 * un servidor real y el histórico de un cliente grande, la app parece colgada.
 *
 * Ojo con el alcance: el `layout.tsx` de este mismo segmento NO queda dentro
 * del límite (así lo define la convención), y además lee datos de petición
 * —sesión, inquilino, marca—. En una carga completa desde cero el menú sigue
 * bloqueando; lo que este archivo vuelve instantáneo es la navegación entre
 * pantallas, que es el 95 % de lo que hace quien trabaja aquí todo el día.
 */
export default function Loading() {
  return <PageSkeleton />;
}
