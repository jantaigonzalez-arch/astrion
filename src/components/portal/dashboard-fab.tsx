import { LayoutDashboard, Pencil, Plus } from "lucide-react";
import { isAdminRole } from "@/lib/roles";
import { MODULOS } from "@/lib/ml/analyses";
import { currentRole } from "@/lib/tenancy/context";
import { tablerosDelModulo, tablerosDelMenu } from "@/lib/ml/dashboards";
import { tableroVisiblePara } from "@/lib/portal/menu";
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
 * ── Y CUÁL ABRE, CUANDO HAY VARIOS ────────────────────────────────────────
 *
 * Desde que un tablero puede publicarse en varios módulos, un módulo puede
 * tener varios tableros. El botón abre, en este orden: el primero PUBLICADO, y
 * entre los publicados el que tiene a este módulo como principal. Si ninguno
 * está publicado, el principal. Dice en su `title` cuántos más hay.
 *
 * Publicado manda sobre principal a propósito: el equipo solo puede ver lo
 * publicado, así que un botón que abriera el borrador principal llevaría a la
 * mayoría de la gente a una pantalla que no tiene permiso de ver.
 *
 * Un botón que despliega una lista sería la otra opción y es peor aquí: la
 * gracia del flotante es que es UN gesto para salir a mirar cómo va el módulo.
 * Convertirlo en un menú lo devuelve a ser un control más de la pantalla, que
 * es justo de lo que se lo sacó. La lista completa vive en la barra lateral,
 * que es donde se elige entre cosas.
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
  // La MISMA lectura que la barra lateral, y en la misma caché por empresa: el
  // botón no añade ni una consulta. Fue una regresión medida y no una idea:
  // cuando el menú pasó a caché de datos, este botón —que antes compartía la
  // lectura memoizada por petición— volvió a consultar en cada pantalla de
  // módulo. Una sola fuente lo cierra.
  //
  // Y la lista ya codifica los tres estados: quien no aparece en ella es
  // exactamente quien no tiene nada compuesto. Ver `tablerosDelMenu`.
  const [role, todos] = await Promise.all([currentRole(), tablerosDelMenu()]);
  const admin = isAdminRole(role);

  const info = MODULOS.find((m) => m.id === modulo);
  if (!info || !role) return null;

  // Ya vienen con el principal delante (ver `tablerosDelModulo`), así que
  // buscar el primero publicado da «el publicado más principal» de una vez.
  //
  // Y se filtra por la MISMA regla que el menú y que la pantalla del tablero:
  // este botón manda a una dirección, así que ofrecer lo que esa dirección va a
  // rechazar es exactamente el botón que lleva a una pantalla vacía del que
  // habla la cabecera. En particular deja fuera los tableros compuestos solo de
  // análisis de administración, que para el resto del equipo no tienen nada.
  const aqui = tablerosDelModulo(todos, modulo).filter((t) =>
    tableroVisiblePara(role, t),
  );
  const d = aqui.find((t) => t.publicado) ?? aqui[0];
  const publicado = Boolean(d?.publicado);

  // Sin publicar, el tablero no existe para el equipo. Ver la cabecera.
  if (!publicado && !admin) return null;

  // Cuántos MÁS hay, para decirlo en el `title` en vez de callarlo: quien ve el
  // botón tiene que poder enterarse de que en el menú hay otros dos.
  const otros = aqui.length - 1;

  const { Icon, texto, titulo, href } = publicado
    ? {
        Icon: LayoutDashboard,
        texto: "Ver tablero",
        // El nombre va en el `title` y no en el botón: el nombre puede ser
        // largo —ése es justo el punto de poder cambiarlo— y un flotante que
        // crece con él acabaría tapando media pantalla en algún módulo.
        // `d` existe si está publicado: `publicado` sale de él.
        titulo:
          otros > 0
            ? `${d!.title} · hay ${otros} tablero${otros === 1 ? "" : "s"} más en el menú`
            : d!.title,
        href: `/admin/dashboard/${d!.slug}`,
      }
    : d
      ? {
          Icon: Pencil,
          texto: "Terminar tablero",
          titulo: `${d.title} · sin publicar, solo lo ves tú`,
          href: `/admin/dashboard/${d.slug}/componer`,
        }
      : {
          Icon: Plus,
          texto: "Crear tablero",
          titulo: `${info.label} todavía no tiene tablero`,
          href: `/admin/dashboard/nuevo?modulo=${modulo}`,
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
