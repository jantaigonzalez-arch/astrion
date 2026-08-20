"use client";

import { useActionState, useMemo, useState } from "react";
import {
  Check,
  EyeOff,
  GripVertical,
  Loader2,
  Rows3,
  Columns2,
  LayoutDashboard,
  Send,
  Undo2,
  XCircle,
} from "lucide-react";
import {
  setDashboardModulesAction,
  publishDashboardAction,
  renameDashboardAction,
  reorderDashboardAction,
  unpublishDashboardAction,
  type DashState,
} from "@/lib/actions/dashboards";
import { Card } from "@/components/ui/card";
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
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {/* El campo ES el encabezado: se ve como el título del tablero y se
                escribe encima. Un <input> disfrazado y no un texto que se
                convierte en campo al hacer clic — eso último esconde que se
                puede editar justo a quien no sabe que se puede. */}
            <form action={renombrar} className="flex min-w-0 flex-1 items-center gap-1">
              <input type="hidden" name="slug" value={slug} />
              <input
                name="title"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                maxLength={120}
                aria-label="Nombre del tablero"
                className={cn(
                  "min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-0.5",
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
                  Guardar nombre
                </Button>
              )}
            </form>
            {publicado ? (
              <Badge className="border-success/30 bg-success/15 text-success">
                Publicado
              </Badge>
            ) : (
              <Badge className="border-border bg-secondary text-muted-foreground">
                Sin publicar
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {encendidos} de {lista.length} análisis encendidos.{" "}
            {publicado
              ? "El equipo ya lo ve."
              : "Solo tú lo ves hasta que lo publiques."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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

          <form action={guardar}>
            <input type="hidden" name="slug" value={slug} />
            {/* La lista entera viaja serializada. Ver la cabecera. */}
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
            <Button type="submit" size="sm" disabled={!sucio || guardando}>
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
        </div>

        {[guardado, ren, mods, pub, despub].map((s, i) =>
          s.error ? (
            <p key={i} className="flex w-full items-start gap-1.5 text-xs text-destructive">
              <XCircle className="mt-0.5 size-3.5 shrink-0" />
              {s.error}
            </p>
          ) : s.message ? (
            <p key={i} className="w-full text-xs text-muted-foreground">
              {s.message}
            </p>
          ) : null,
        )}
      </Card>

      {/*
        DÓNDE SALE ESTE TABLERO.

        Su propia tarjeta y no un renglón de la cabecera, porque es una decisión
        distinta de las otras dos que se toman aquí. Componer es «qué dice»;
        publicar es «el equipo puede verlo»; esto es «por dónde se llega». Un
        tablero puede estar publicado y no salir en ningún módulo —se llega por
        el menú— o estar en tres y seguir siendo borrador.

        Se eligen varios a propósito: un cierre de mes interesa en Ventas y en
        Rentabilidad, y obligar a elegir uno llevaba a duplicar el tablero.
      */}
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Dónde sale</h3>
            <p className="mt-1 max-w-xl text-xs text-muted-foreground">
              Los módulos donde aparece su botón. El primero que elijas es su
              módulo principal: en esa pantalla, el botón abre este tablero. En
              los demás también sale, y se llega por el menú lateral. Sin
              ninguno, el tablero solo vive en el menú.
            </p>
          </div>
          {dondeSucio && (
            <form action={guardarModulos}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="modulos" value={donde.join(",")} />
              <Button type="submit" size="sm" disabled={guardandoModulos}>
                {guardandoModulos ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Check className="size-3.5" />
                )}
                Guardar dónde sale
              </Button>
            </form>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {catalogo.map((m) => {
            const puesto = donde.indexOf(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => alternar(m.id)}
                aria-pressed={puesto >= 0}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs",
                  "transition-colors",
                  puesto >= 0
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:bg-secondary",
                )}
              >
                {/* El número dice el orden, que es lo que decide cuál abre el
                    botón cuando un módulo tiene varios tableros. Sin él, «el
                    primero» sería una regla invisible. */}
                {puesto >= 0 && (
                  <span className="font-mono text-[10px] text-primary">{puesto + 1}</span>
                )}
                {m.label}
              </button>
            );
          })}
        </div>
      </Card>

      {/*
        EL TABLERO, VIVO, Y LA CAJA AL COSTADO.

        La vista principal son los bloques resueltos —sus cifras, sus gráficas—
        y no una lista de nombres. Componer mirando el resultado es la
        diferencia entre decidir si «Clientes más rentables» merece media fila y
        tener que imaginárselo.

        Dos columnas y no una superposición: de la caja se ARRASTRA hacia el
        tablero, así que las dos tienen que verse a la vez. Ver `DashboardToolbox`.
      */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
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

              {/* Cola del tablero: soltar aquí lo pone al final. Sin esta zona,
                  el último puesto solo se alcanzaría soltando sobre el último
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

        <DashboardToolbox
          // Se aplana a lo que la caja necesita —y `piezas` es lo que ella
          // añade: cuántos bloques trae hoy, para poder decir «hoy sin datos»
          // sin que la caja tenga que saber qué es un `Block`.
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
          arrastrando={arrastrando}
          onAgregar={(id) => alFinal(id)}
          onArrastrar={(id, desde) => setArrastrando(desde ? { id, desde } : null)}
          onSoltarFuera={(id) => {
            cambiar(id, { active: false });
            setArrastrando(null);
          }}
        />
      </div>
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
