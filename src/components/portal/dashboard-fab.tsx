import { LayoutDashboard, Pencil, Plus } from "lucide-react";
import { isAdminRole } from "@/lib/roles";
import { currentRole } from "@/lib/tenancy/context";
import { dashboardStates } from "@/lib/ml/dashboards";
import { Link } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * El acceso al tablero del módulo: un botón flotante, anclado abajo a la
 * derecha.
 *
 * ── POR QUÉ FLOTANTE Y NO EN EL ENCABEZADO ─────────────────────────────────
 *
 * Antes era un botón discreto arriba a la derecha, y ahí no se veía. No por
 * tamaño: por VECINDAD. El encabezado de cada módulo ya tiene el título, el
 * subtítulo y los botones del trabajo —«Nuevo levantamiento», el selector de
 * embudo, los filtros—, y un botón más en esa fila se lee como uno más de esos.
 * El tablero no es una acción del módulo, es la salida a otra pantalla, y
 * mezclarlo con las acciones lo hacía desaparecer entre ellas.
 *
 * Flotando ocupa una capa que no pertenece a nadie más, así que no compite con
 * nada. Es el mismo motivo por el que el asa de plegar la barra lateral cuelga
 * del borde en vez de ser un renglón del menú.
 *
 * ── QUÉ CUESTA, Y POR QUÉ SE ACEPTA ────────────────────────────────────────
 *
 * Un flotante tapa una esquina del contenido. Se acepta porque tapa la esquina
 * inferior derecha, que en estas pantallas es el final de una tabla o el aire
 * después del último bloque, y porque el gesto que habilita —salir a ver cómo
 * va el módulo— es de los que se hacen ANTES o DESPUÉS de trabajar, nunca a
 * mitad de una fila.
 *
 * ── CUÁNDO APARECE ────────────────────────────────────────────────────────
 *
 * Publicado           → para todo el que tenga acceso al módulo.
 * Sin publicar        → solo para quien puede componerlo, y lleva al compositor.
 * Sin nada compuesto  → para nadie, salvo administración, con «Crear tablero».
 *
 * La regla de fondo: un botón que lleva a una pantalla vacía es peor que no
 * tener botón. Se pulsa una vez, no hay nada, y no se vuelve a pulsar nunca —
 * ni el día que sí tenga algo. Y flotando, esa regla pesa más: lo que está
 * siempre a la vista tiene que valer la pena siempre.
 *
 * ── POR QUÉ NO LLEVA UN CONTADOR ──────────────────────────────────────────
 *
 * Sería el adorno obvio —«Ver tablero (5)»— y diría una mentira útil. Lo único
 * que se sabe sin resolver los bloques es cuántos análisis hay CONFIGURADOS, y
 * un número en una burbuja se lee como cuántas cosas piden atención. Saber lo
 * segundo exige resolver el tablero entero para pintar un botón, que es
 * exactamente el trabajo que este componente evita.
 *
 * ── POR QUÉ ES UN COMPONENTE DE SERVIDOR ───────────────────────────────────
 *
 * Porque decidir si aparece exige leer el estado del tablero, y hacerlo en el
 * cliente significaría una petición más por pantalla solo para saber si dibujar
 * un botón. Va dentro del `Suspense` de quien lo usa, así que no retrasa nada —
 * y como es `fixed`, llegar tarde no mueve ni un píxel de la página.
 */
export async function DashboardFab({ modulo }: { modulo: string }) {
  // `dashboardStates` y no `dashboardFor`, que es la versión completa: aquella
  // resuelve además QUÉ SE PODRÍA AGREGAR al tablero —un filtro sobre el
  // catálogo entero— y devuelve cada bloque con su análisis resuelto. Para
  // dibujar un botón hacen falta tres datos: si está publicado, cuántos bloques
  // tiene encendidos y cómo se llama.
  //
  // Y hay una segunda razón, la que de verdad lo hace gratis: esta es la misma
  // lectura que la barra lateral ya hizo para pintar su sección de tableros, y
  // está memoizada por petición. El botón no añade ni una consulta.
  const [admin, estados] = await Promise.all([
    currentRole().then(isAdminRole),
    dashboardStates(),
  ]);

  const d = estados.find((s) => s.modulo.id === modulo);
  if (!d) return null;

  const publicado = Boolean(d.publishedAt);
  const encendidos = d.bloques;

  // Sin publicar, el tablero no existe para el equipo. Ver la cabecera.
  if (!publicado && !admin) return null;

  const { Icon, texto, titulo, href } = publicado
    ? {
        Icon: LayoutDashboard,
        texto: "Ver tablero",
        // El nombre va en el `title` y no en el botón: el nombre puede ser
        // largo —ése es justo el punto de poder cambiarlo— y un flotante que
        // crece con él acabaría tapando media pantalla en algún módulo.
        titulo: d.title,
        href: `/admin/dashboard/${modulo}`,
      }
    : encendidos > 0
      ? {
          Icon: Pencil,
          texto: "Terminar tablero",
          titulo: `${d.title} · sin publicar, solo lo ves tú`,
          href: `/admin/dashboard/${modulo}/componer`,
        }
      : {
          Icon: Plus,
          texto: "Crear tablero",
          titulo: `${d.modulo.label} todavía no tiene tablero`,
          href: `/admin/dashboard/${modulo}/componer`,
        };

  return (
    <Link
      href={href}
      title={titulo}
      className={cn(
        // `fixed` y no `sticky`: tiene que quedarse quieto mientras la tabla de
        // abajo se recorre, que es cuando más falta hace saber que la salida
        // sigue ahí.
        "no-print fixed bottom-6 right-6 z-40 inline-flex items-center gap-2.5",
        "rounded-full px-5 py-3 text-sm font-medium shadow-lg",
        "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        // Entra deslizándose desde abajo: es lo que lo delata en una pantalla
        // que el usuario ya creía conocer. Una sola vez, al cargar, y bajo
        // `motion-safe` para que quien pidió menos movimiento no lo sufra.
        "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4",
        "motion-safe:duration-500",
        publicado
          ? // El mismo degradado que la variante `accent` de los botones: en
            // este sistema es la señal de «esto es lo destacado», y estrenar un
            // color propio para el flotante habría añadido un tercer acento que
            // no significa nada nuevo.
            "bg-gradient-to-r from-brand-500 to-signal text-white shadow-primary/25 hover:brightness-110"
          : // Sin publicar es trabajo pendiente de una persona, no una
            // invitación al equipo: se queda en tono de tarjeta para que no
            // grite desde todas las pantallas del administrador.
            "border border-border bg-card/85 text-foreground backdrop-blur hover:bg-card",
      )}
    >
      <Icon className="size-4 shrink-0" />
      {texto}
    </Link>
  );
}
