"use client";

import { useActionState, useMemo, useState } from "react";
import {
  Check,
  EyeOff,
  GripVertical,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Rows3,
  Columns2,
  LayoutDashboard,
  Send,
  Trash2,
  Undo2,
  XCircle,
} from "lucide-react";
import {
  deleteDashboardAction as borrar,
  setDashboardModulesAction,
  publishDashboardAction,
  renameDashboardAction,
  reorderDashboardAction,
  unpublishDashboardAction,
  type DashState,
} from "@/lib/actions/dashboards";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DashboardToolbox } from "@/components/portal/dashboard-toolbox";
import { InsightItem } from "@/components/portal/insight-strip";
import {
  ForecastCard,
  ProjectionCard,
  TrendCard,
} from "@/components/portal/assistant-blocks";
import type { Block } from "@/lib/ml/blocks-types";
import { cn } from "@/lib/utils";

const inicial: DashState = { ok: false };

/**
 * Cookie del panel plegado.
 *
 * La misma idea que `SIDEBAR_COOKIE`: es una preferencia de cómo se trabaja, no
 * un dato de sesión, así que dura un año. A diferencia de aquélla NO la lee el
 * servidor —esta pantalla no tiene el salto de la barra lateral, porque el
 * panel no cambia el ancho de lo que ya está pintado— y leerla en el cliente
 * evita pasarla por props desde la página.
 */
const PANEL_COOKIE = "evo_composer_panel";

export type BloqueView = {
  analysis: string;
  label: string;
  kind: string;
  watching: string[];
  active: boolean;
  width: "full" | "half";
  source: "user" | "system" | "factory";
  /**
   * Lo que este análisis enseña HOY, ya resuelto en el servidor.
   *
   * Viaja con el bloque para que soltarlo en el tablero lo pinte en el acto.
   * Pedirlo al servidor al soltar habría dejado un hueco cargando justo en el
   * momento en que la persona quiere ver si el bloque encaja — que es el
   * momento entero de esta pantalla.
   */
  preview: Block[];
};

export type DisponibleView = {
  id: string;
  label: string;
  kind: string;
  watching: string[];
  preview: Block[];
};


/**
 * El compositor de un tablero.
 *
 * ── EL ARRASTRE ES NATIVO ──────────────────────────────────────────────────
 *
 * HTML5 sin biblioteca, igual que el tablero del embudo. No es ahorro: es que
 * lo que hace falta aquí —tomar una fila y soltarla en otra posición— es
 * exactamente lo que la API nativa hace bien. Las bibliotecas de arrastre pagan
 * su peso cuando hay rejillas con colisiones, cambio de tamaño o listas
 * anidadas, y nada de eso está aquí.
 *
 * ── EL ORDEN SE EDITA EN EL CLIENTE Y SE GUARDA ENTERO ─────────────────────
 *
 * Cada movimiento reordena la lista en memoria; el botón de guardar manda la
 * lista COMPLETA. Dos razones: arrastrar tiene que verse instantáneo —esperar
 * al servidor entre soltar y ver el resultado convierte el gesto en un
 * formulario— y mandar el orden entero hace que el último guardado gane sin
 * ambigüedad. Ver `reorderDashboard`.
 *
 * Lo que NO se hace es guardar en cada soltada. Acomodar un tablero son diez o
 * quince movimientos seguidos, y guardar en cada uno son quince escrituras y
 * quince oportunidades de que el equipo vea un orden a medias.
 *
 * ── APAGADO NO ES BORRADO ──────────────────────────────────────────────────
 *
 * Un bloque apagado se queda en la lista, en gris. Es lo que permite quitarlo
 * del tablero sin perder dónde estaba, y lo que hace que el compositor enseñe
 * TODO lo que el tablero podría mostrar — que es la mitad de la información:
 * quien compone tiene que ver lo que está dejando fuera.
 *
 * ── EL NOMBRE SE EDITA AQUÍ Y NO EN UN DIÁLOGO ─────────────────────────────
 *
 * Los siete de fábrica nacen llamándose «Dashboard de Compras», que es una
 * descripción, no un nombre. El que acaba sirviendo —«Lo que hay que pagar esta semana»— dice
 * para qué se abre, y esa frase solo la sabe quien lo compuso, en el momento en
 * que termina de componerlo. Por eso el campo vive en la cabecera del
 * compositor, editable en el sitio: mandarlo a un diálogo aparte lo convierte
 * en un trámite que nadie hace, y el tablero se queda con la descripción para
 * siempre.
 *
 * Se guarda con su propio botón y no al perder el foco. Renombrar es una
 * escritura y el resto de la pantalla ya enseña explícitamente qué está
 * guardado y qué no; un guardado silencioso al salir del campo sería la única
 * cosa de esta pantalla que cambia la base sin que nadie lo pida.
 */
export function DashboardBuilder({
  slug,
  titulo,
  modulos,
  catalogo,
  publicado,
  bloques,
  disponibles,
}: {
  slug: string;
  titulo: string;
  /** Los módulos donde sale hoy. Puede estar vacío. */
  modulos: string[];
  /** Todos los módulos del ERP, para elegir. */
  catalogo: Array<{ id: string; label: string }>;
  publicado: string | null;
  bloques: BloqueView[];
  disponibles: DisponibleView[];
}) {
  const [lista, setLista] = useState(bloques);
  const [nombre, setNombre] = useState(titulo);
  const [donde, setDonde] = useState<string[]>(modulos);
  /**
   * Qué se está arrastrando y DE DÓNDE.
   *
   * El origen importa tanto como la identidad: soltar algo que viene del
   * tablero lo reordena, y soltar algo que viene de la caja lo inserta. Sin
   * guardar el origen habría que deducirlo de la lista en cada `dragover`, y
   * `dataTransfer` no se puede leer durante el arrastre — solo al soltar.
   */
  const [arrastrando, setArrastrando] = useState<{
    id: string;
    desde: "tablero" | "disponible" | "quitado";
  } | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);

  /*
    El panel plegado, para trabajar a pantalla completa.

    La preferencia se lee UNA vez al crear el estado y no en un efecto: en un
    efecto sería `setState` durante el montaje, o sea un segundo render y un
    parpadeo del panel abriéndose para cerrarse. El inicializador perezoso de
    `useState` corre antes del primer pintado.

    Se lee en el cliente y no en el servidor —al revés que la barra lateral—
    porque aquí no hay salto que evitar: plegar el panel no cambia el ancho de
    nada que ya esté pintado. Y leerlo en el servidor habría obligado a pasar la
    preferencia por props a través de dos pantallas.
  */
  const [plegado, setPlegado] = useState(
    () => typeof document !== "undefined" && document.cookie.includes(`${PANEL_COOKIE}=1`),
  );

  function plegar(next: boolean) {
    setPlegado(next);
    document.cookie = `${PANEL_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  }

  const [guardado, guardar, guardando] = useActionState(reorderDashboardAction, inicial);
  const [ren, renombrar, renombrando] = useActionState(renameDashboardAction, inicial);
  const [mods, guardarModulos, guardandoModulos] = useActionState(
    setDashboardModulesAction,
    inicial,
  );
  const [pub, publicar, publicando] = useActionState(publishDashboardAction, inicial);
  const [despub, despublicar, despublicando] = useActionState(
    unpublishDashboardAction,
    inicial,
  );

  // Se compara contra lo que llegó del servidor, no contra un booleano suelto:
  // deshacer un movimiento tiene que volver a dejar el botón tranquilo.
  const sucio = useMemo(
    () => JSON.stringify(lista) !== JSON.stringify(bloques),
    [lista, bloques],
  );
  const encendidos = lista.filter((b) => b.active).length;

  /*
    Tres vistas de un mismo estado.

    `lista` guarda TODO lo colocado alguna vez, encendido o no, porque eso es lo
    que se manda al guardar: una fila apagada es una decisión —«esto no lo
    quiero»— y borrarla haría que el análisis volviera solo de fábrica en la
    siguiente carga. Ver `placements.ts`.
  */
  const enTablero = lista.filter((b) => b.active);
  const quitados = lista.filter((b) => !b.active);
  const caja = disponibles.filter((d) => !lista.some((b) => b.analysis === d.id));

  const comoBloque = (d: DisponibleView): BloqueView => ({
    analysis: d.id,
    label: d.label,
    kind: d.kind,
    watching: d.watching,
    active: true,
    width: "full",
    source: "user",
    preview: d.preview,
  });

  // Se compara ya recortado: el servidor guarda `trim()`, así que un espacio al
  // final no es un cambio y el botón no debería encenderse por él.
  const nombreSucio = nombre.trim().length > 0 && nombre.trim() !== titulo;

  // El ORDEN importa: el primero es el que abre el botón flotante del módulo.
  // Por eso se compara la lista tal cual y no como conjunto.
  const dondeSucio = JSON.stringify(donde) !== JSON.stringify(modulos);

  const alternar = (id: string) =>
    setDonde((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));



  const cambiar = (id: string, parche: Partial<BloqueView>) =>
    setLista((xs) => xs.map((x) => (x.analysis === id ? { ...x, ...parche } : x)));

  /** Lo pone al final del tablero, encendido, venga de donde venga. */
  function alFinal(id: string) {
    setLista((xs) => {
      const ya = xs.find((x) => x.analysis === id);
      if (ya) return [...xs.filter((x) => x.analysis !== id), { ...ya, active: true }];
      const nuevo = disponibles.find((d) => d.id === id);
      return nuevo ? [...xs, comoBloque(nuevo)] : xs;
    });
    setArrastrando(null);
    setSobre(null);
  }

  /**
   * Suelta lo que se arrastra EN el sitio de `hasta`.
   *
   * Reordenar e insertar son la misma operación desde el punto de vista de
   * quien arrastra —«esto va aquí»— y por eso salen del mismo sitio: la
   * diferencia es solo si el bloque ya estaba en la lista.
   */
  function soltarEn(hasta: string) {
    const a = arrastrando;
    setArrastrando(null);
    setSobre(null);
    if (!a || a.id === hasta) return;

    setLista((xs) => {
      const j = xs.findIndex((x) => x.analysis === hasta);
      if (j < 0) return xs;

      const ya = xs.find((x) => x.analysis === a.id);
      const copia = ya
        ? xs.filter((x) => x.analysis !== a.id)
        : [...xs];
      const pieza = ya
        ? { ...ya, active: true }
        : (() => {
            const d = disponibles.find((x) => x.id === a.id);
            return d ? comoBloque(d) : null;
          })();
      if (!pieza) return xs;

      // El destino se vuelve a buscar sobre la copia: si lo que se movía estaba
      // ANTES, quitarlo corrió todos los índices una posición.
      const k = copia.findIndex((x) => x.analysis === hasta);
      copia.splice(k < 0 ? copia.length : k, 0, pieza);
      return copia;
    });
  }

  return (
    /*
      DOS ZONAS: el espacio de trabajo y el panel.

      Todo lo que se DECIDE —cómo se llama, dónde sale, qué lleva— vive en el
      panel de la derecha, y la izquierda queda entera para el tablero. Antes el
      nombre y los módulos ocupaban dos tarjetas a lo ancho, encima del tablero:
      empujaban hacia abajo justo lo que hay que mirar para decidir, y eran lo
      primero que se dejaba de leer después del primer minuto.

      Al costado se leen igual de bien y no le quitan sitio a nada. Es el mismo
      reparto que la barra lateral del portal, del otro lado.
    */
    <div
      className={cn(
        "grid gap-4",
        plegado ? "lg:grid-cols-1" : "lg:grid-cols-[minmax(0,1fr)_340px]",
      )}
    >
      {/* ───────────────── ESPACIO DE TRABAJO ───────────────── */}
      <div>
        {enTablero.length === 0 ? (
          <ZonaVacia
            activa={Boolean(arrastrando) && arrastrando?.desde !== "tablero"}
            onSoltar={() => arrastrando && alFinal(arrastrando.id)}
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {enTablero.map((b) => (
              <BloqueEditable
                key={b.analysis}
                b={b}
                arrastrado={arrastrando?.id === b.analysis}
                sobre={sobre === b.analysis}
                onArrastrar={(id) =>
                  setArrastrando(id ? { id, desde: "tablero" } : null)
                }
                onSobre={setSobre}
                onSoltar={() => soltarEn(b.analysis)}
                onAncho={(w) => cambiar(b.analysis, { width: w })}
                onQuitar={() => cambiar(b.analysis, { active: false })}
              />
            ))}

            {/* Cola del tablero: soltar aquí lo pone al final. Sin esta zona el
                último puesto solo se alcanzaría soltando sobre el último
                bloque, que lo insertaría ANTES. */}
            <ZonaFinal
              activa={Boolean(arrastrando)}
              onSoltar={() => arrastrando && alFinal(arrastrando.id)}
            />
          </div>
        )}

        {enTablero.length > 1 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Arrastra por el asa para reordenar. Nada se guarda hasta que pulses
            «Guardar tablero».
          </p>
        )}
      </div>

      {/* ───────────────── EL PANEL ───────────────── */}
      {/* Plegado, el panel se va del todo y deja una pestaña en el borde. No se
          encoge a un riel de iconos como la barra lateral: de aquí se ARRASTRA,
          y una tira sin nombres no diría de qué se está tirando. */}
      {plegado ? (
        <button
          type="button"
          onClick={() => plegar(false)}
          title="Abrir el panel"
          className={cn(
            "fixed right-0 top-1/2 z-30 hidden -translate-y-1/2 items-center gap-1.5 rounded-l-lg",
            "border border-r-0 border-border bg-card px-2 py-3 text-xs text-muted-foreground",
            "shadow-lg transition-colors hover:text-foreground lg:flex",
          )}
        >
          <ChevronLeft className="size-4" />
          <span className="[writing-mode:vertical-rl]">Panel</span>
        </button>
      ) : (
      <aside
        onDragOver={(e) => {
          if (arrastrando?.desde !== "tablero") return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={(e) => {
          if (arrastrando?.desde !== "tablero") return;
          e.preventDefault();
          cambiar(arrastrando.id, { active: false });
          setArrastrando(null);
        }}
        className={cn(
          // Pegajoso y de alto completo: acomodar un tablero largo es
          // desplazarse por él, y un panel que se va hacia arriba obliga a
          // volver por cada bloque que se agrega.
          "lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]",
          "flex flex-col overflow-hidden rounded-xl border bg-card transition-colors",
          arrastrando?.desde === "tablero"
            ? "border-destructive/50 bg-destructive/5"
            : "border-border",
        )}
      >
        {/* ── El nombre ── */}
        <div className="shrink-0 border-b border-border p-4">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="titulo" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Nombre del tablero
            </label>
            <button
              type="button"
              onClick={() => plegar(true)}
              title="Plegar el panel"
              aria-label="Plegar el panel"
              className="ml-auto hidden rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground lg:block"
            >
              <ChevronRight className="size-4" />
            </button>
            {publicado ? (
              <Badge className="border-success/30 bg-success/15 text-success">
                Publicado
              </Badge>
            ) : (
              <Badge className="border-border bg-secondary text-muted-foreground">
                Borrador
              </Badge>
            )}
          </div>

          {/* El campo se ve como el título y se escribe encima. Un <input>
              disfrazado y no un texto que se convierte en campo al hacer clic —
              eso último esconde que se puede editar justo a quien no lo sabe. */}
          <form action={renombrar} className="mt-1.5 flex items-center gap-1">
            <input type="hidden" name="slug" value={slug} />
            <input
              id="titulo"
              name="title"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              maxLength={120}
              className={cn(
                "min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1",
                "text-base font-semibold outline-none transition-colors",
                "hover:border-border focus:border-primary focus:bg-background",
              )}
            />
            {nombreSucio && (
              <Button type="submit" variant="ghost" size="sm" disabled={renombrando}>
                {renombrando ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Check className="size-3.5" />
                )}
              </Button>
            )}
          </form>

          <p className="mt-1 px-1.5 text-xs text-muted-foreground">
            {encendidos} análisis en el tablero.{" "}
            {publicado ? "El equipo ya lo ve." : "Solo tú lo ves."}
          </p>

          {/* ── Lo que se guarda ── */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <form action={guardar} className="flex-1">
              <input type="hidden" name="slug" value={slug} />
              {/* La composición entera viaja serializada. Ver la cabecera. */}
              <input
                type="hidden"
                name="orden"
                value={JSON.stringify(
                  lista.map((b) => ({
                    analysis: b.analysis,
                    width: b.width,
                    active: b.active,
                  })),
                )}
              />
              <Button type="submit" size="sm" className="w-full" disabled={!sucio || guardando}>
                {guardando ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Check className="size-3.5" />
                )}
                Guardar tablero
              </Button>
            </form>

            <form action={publicado ? despublicar : publicar}>
              <input type="hidden" name="slug" value={slug} />
              <Button
                type="submit"
                size="sm"
                variant={publicado ? "outline" : "accent"}
                disabled={publicando || despublicando || sucio}
                title={
                  sucio
                    ? "Guarda el tablero antes de publicar: si no, se publicaría lo anterior."
                    : undefined
                }
              >
                {(publicando || despublicando) && (
                  <Loader2 className="size-3.5 animate-spin" />
                )}
                {publicado ? (
                  <>
                    <EyeOff className="size-3.5" /> Retirar
                  </>
                ) : (
                  <>
                    <Send className="size-3.5" /> Publicar
                  </>
                )}
              </Button>
            </form>

            {sucio && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLista(bloques)}
                disabled={guardando}
              >
                <Undo2 className="size-3.5" /> Descartar
              </Button>
            )}
          </div>

          {[guardado, ren, mods, pub, despub].map((s, i) =>
            s.error ? (
              <p key={i} className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
                <XCircle className="mt-0.5 size-3.5 shrink-0" />
                {s.error}
              </p>
            ) : s.message ? (
              <p key={i} className="mt-2 text-xs text-muted-foreground">
                {s.message}
              </p>
            ) : null,
          )}
        </div>

        {/* ── Dónde sale ── */}
        <div className="shrink-0 border-b border-border p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Publicar en
            </h3>
            {dondeSucio && (
              <form action={guardarModulos}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="modulos" value={donde.join(",")} />
                <Button type="submit" variant="ghost" size="sm" disabled={guardandoModulos}>
                  {guardandoModulos ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Check className="size-3.5" />
                  )}
                  Guardar
                </Button>
              </form>
            )}
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {catalogo.map((m) => {
              const puesto = donde.indexOf(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => alternar(m.id)}
                  aria-pressed={puesto >= 0}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px]",
                    "transition-colors",
                    puesto >= 0
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-secondary",
                  )}
                >
                  {/* El número dice el orden, y el orden decide cuál abre el
                      botón de esa pantalla. Sin él sería una regla invisible. */}
                  {puesto >= 0 && (
                    <span className="font-mono text-[10px] text-primary">{puesto + 1}</span>
                  )}
                  {m.label}
                </button>
              );
            })}
          </div>

          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            El primero es su módulo principal: ahí el botón de la pantalla abre
            este tablero. Sin ninguno, solo se llega por el menú.
          </p>
        </div>

        {/* ── Lo que se puede poner ── */}
        <DashboardToolbox
          disponibles={caja.map((d) => ({
            id: d.id,
            label: d.label,
            kind: d.kind,
            watching: d.watching,
            piezas: d.preview.length,
          }))}
          quitados={quitados.map((b) => ({
            id: b.analysis,
            label: b.label,
            kind: b.kind,
            watching: b.watching,
            piezas: b.preview.length,
          }))}
          quitando={arrastrando?.desde === "tablero"}
          onAgregar={(id) => alFinal(id)}
          onArrastrar={(id, desde) => setArrastrando(desde ? { id, desde } : null)}
        />

        {/*
          Zona de peligro, al pie y separada.

          Abajo del todo y detrás de la lista: borrar no es algo que se busque,
          es algo que se encuentra cuando se necesita. Ponerlo arriba —al lado
          de «Guardar»— sería poner la acción irreversible junto a la que más se
          pulsa.

          La confirmación es del navegador y no un diálogo propio, como en el
          borrado de contratos: para una pregunta de sí o no, un diálogo a
          medida es más código y una cosa más que puede fallar.
        */}
        <form
          action={borrar}
          className="shrink-0 border-t border-border p-3"
          onSubmit={(e) => {
            if (
              !confirm(
                `¿Borrar «${titulo}»? Se van su composición y los módulos donde ` +
                  "sale. Los análisis siguen existiendo. Esto no se puede deshacer.",
              )
            ) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="slug" value={slug} />
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-3.5" /> Borrar este tablero
          </Button>
        </form>
      </aside>
      )}
    </div>
  );
}

/**
 * Un bloque del tablero, tal como se ve, con sus controles encima.
 *
 * Los controles aparecen al acercar el cursor y no siempre: si estuvieran fijos
 * competirían con el contenido en cada bloque, y el contenido es justo lo que
 * esta pantalla existe para enseñar. El asa de arrastre sí se insinúa, porque
 * es lo único que no se adivina.
 */
function BloqueEditable({
  b,
  arrastrado,
  sobre,
  onArrastrar,
  onSobre,
  onSoltar,
  onAncho,
  onQuitar,
}: {
  b: BloqueView;
  arrastrado: boolean;
  sobre: boolean;
  onArrastrar: (id: string | null) => void;
  onSobre: (id: string | null) => void;
  onSoltar: () => void;
  onAncho: (w: "full" | "half") => void;
  onQuitar: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        onArrastrar(b.analysis);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", b.analysis);
      }}
      onDragEnd={() => {
        onArrastrar(null);
        onSobre(null);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!sobre) onSobre(b.analysis);
      }}
      onDragLeave={() => onSobre(null)}
      onDrop={(e) => {
        e.preventDefault();
        onSoltar();
      }}
      className={cn(
        "group relative rounded-xl border transition-all",
        b.width === "full" && "lg:col-span-2",
        arrastrado && "opacity-40",
        sobre && !arrastrado
          ? "border-primary ring-2 ring-primary/30"
          : "border-transparent",
      )}
    >
      {/* La barra de controles flota encima del bloque en vez de empujarlo:
          así el bloque se ve del tamaño que va a tener de verdad. */}
      <div
        className={cn(
          "absolute right-2 top-2 z-10 flex items-center gap-1 rounded-lg border border-border",
          "bg-card/95 p-1 shadow-sm backdrop-blur transition-opacity",
          "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
        )}
      >
        {(["full", "half"] as const).map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => onAncho(w)}
            title={w === "full" ? "Fila completa" : "Media fila"}
            aria-pressed={b.width === w}
            className={cn(
              "rounded p-1 transition-colors",
              b.width === w
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-secondary/60",
            )}
          >
            {w === "full" ? <Rows3 className="size-3.5" /> : <Columns2 className="size-3.5" />}
          </button>
        ))}
        <button
          type="button"
          onClick={onQuitar}
          title="Quitar del tablero"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <EyeOff className="size-3.5" />
        </button>
      </div>

      <div className="absolute left-2 top-2 z-10 cursor-grab rounded p-1 text-muted-foreground opacity-40 transition-opacity group-hover:opacity-100 active:cursor-grabbing">
        <GripVertical className="size-4" />
      </div>

      {/* Lo que este bloque enseña HOY. Vacío no es un fallo: el análisis está
          vigilando y hoy no encontró nada. Se dice, en vez de dejar un hueco
          que parece un error de carga. */}
      {b.preview.length > 0 ? (
        <div className="space-y-3">
          {b.preview.map((x) => (
            <Pieza key={llave(x)} block={x} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border p-5">
          <p className="text-sm font-medium">{b.label}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Hoy no encontró nada que reportar. Sigue vigilando:
          </p>
          <ul className="mt-1.5 text-xs text-muted-foreground">
            {b.watching.slice(0, 2).map((w) => (
              <li key={w}>· {w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** La cola del tablero: acepta lo que se suelte y lo pone al final. */
function ZonaFinal({ activa, onSoltar }: { activa: boolean; onSoltar: () => void }) {
  const [sobre, setSobre] = useState(false);
  if (!activa) return null;
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setSobre(true);
      }}
      onDragLeave={() => setSobre(false)}
      onDrop={(e) => {
        e.preventDefault();
        setSobre(false);
        onSoltar();
      }}
      className={cn(
        "flex min-h-24 items-center justify-center rounded-xl border-2 border-dashed text-xs",
        sobre
          ? "border-primary bg-primary/5 text-primary"
          : "border-border text-muted-foreground",
      )}
    >
      Soltar al final
    </div>
  );
}

/** El tablero sin nada encendido. */
function ZonaVacia({
  activa,
  onSoltar,
}: {
  activa: boolean;
  onSoltar: () => void;
}) {
  const [sobre, setSobre] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setSobre(true);
      }}
      onDragLeave={() => setSobre(false)}
      onDrop={(e) => {
        e.preventDefault();
        setSobre(false);
        onSoltar();
      }}
      className={cn(
        "flex min-h-64 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center",
        sobre || activa
          ? "border-primary bg-primary/5"
          : "border-border",
      )}
    >
      <LayoutDashboard className="size-8 text-muted-foreground" />
      <p className="text-sm font-medium">Este tablero está vacío</p>
      <p className="max-w-sm text-xs text-muted-foreground">
        Arrastra un análisis de la caja de herramientas, a la derecha. Lo verás
        aquí tal como lo verá el equipo.
      </p>
    </div>
  );
}

function Pieza({ block }: { block: Block }) {
  switch (block.kind) {
    case "finding":
      return <InsightItem insight={block.insight} />;
    case "projection":
      return <ProjectionCard block={block} />;
    case "trend":
      return <TrendCard block={block} />;
    case "forecast":
      return <ForecastCard block={block} />;
  }
}

/** Los hallazgos llevan su id dentro del `insight`; el resto, suelto. */
function llave(b: Block): string {
  return b.kind === "finding" ? b.insight.id : b.id;
}
