"use client";

import { useActionState, useMemo, useState } from "react";
import {
  Check,
  Eye,
  EyeOff,
  GripVertical,
  Loader2,
  Rows3,
  Columns2,
  Plus,
  Send,
  Undo2,
  XCircle,
} from "lucide-react";
import {
  addToDashboardAction,
  publishDashboardAction,
  renameDashboardAction,
  reorderDashboardAction,
  unpublishDashboardAction,
  type DashState,
} from "@/lib/actions/dashboards";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
};

const KIND_LABEL: Record<string, string> = {
  finding: "Requiere atención",
  projection: "Lo que viene",
  trend: "Cómo viene",
  forecast: "Lo que estima un modelo",
};

/**
 * El compositor del dashboard de un módulo.
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
 * TODO lo que ese módulo podría mostrar — que es la mitad de la información:
 * quien compone tiene que ver lo que está dejando fuera.
 *
 * ── EL NOMBRE SE EDITA AQUÍ Y NO EN UN DIÁLOGO ─────────────────────────────
 *
 * Un tablero nace llamándose «Dashboard de Compras», que es una descripción, no
 * un nombre. El que acaba sirviendo —«Lo que hay que pagar esta semana»— dice
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
  modulo,
  moduloLabel,
  titulo,
  publicado,
  bloques,
  disponibles,
}: {
  modulo: string;
  moduloLabel: string;
  titulo: string;
  publicado: string | null;
  bloques: BloqueView[];
  disponibles: Array<{ id: string; label: string; kind: string; watching: string[] }>;
}) {
  const [lista, setLista] = useState(bloques);
  const [nombre, setNombre] = useState(titulo);
  const [arrastrado, setArrastrado] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);

  const [guardado, guardar, guardando] = useActionState(reorderDashboardAction, inicial);
  const [ren, renombrar, renombrando] = useActionState(renameDashboardAction, inicial);
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

  // Se compara ya recortado: el servidor guarda `trim()`, así que un espacio al
  // final no es un cambio y el botón no debería encenderse por él.
  const nombreSucio = nombre.trim().length > 0 && nombre.trim() !== titulo;

  function mover(desde: string, hasta: string) {
    if (desde === hasta) return;
    setLista((xs) => {
      const i = xs.findIndex((x) => x.analysis === desde);
      const j = xs.findIndex((x) => x.analysis === hasta);
      if (i < 0 || j < 0) return xs;
      const copia = [...xs];
      const [x] = copia.splice(i, 1);
      copia.splice(j, 0, x);
      return copia;
    });
  }

  const cambiar = (id: string, parche: Partial<BloqueView>) =>
    setLista((xs) => xs.map((x) => (x.analysis === id ? { ...x, ...parche } : x)));

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
              <input type="hidden" name="modulo" value={modulo} />
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
            {/* El módulo baja aquí al ceder el encabezado al nombre. Sigue
                haciendo falta: el nombre puede acabar sin decir de qué módulo
                es, y esta pantalla se abre desde siete sitios distintos. */}
            {moduloLabel} · {encendidos} de {lista.length} análisis encendidos.{" "}
            {publicado
              ? "El equipo lo ve desde el botón «Dashboard» del módulo."
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
            <input type="hidden" name="modulo" value={modulo} />
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
              Guardar orden
            </Button>
          </form>

          <form action={publicado ? despublicar : publicar}>
            <input type="hidden" name="modulo" value={modulo} />
            <Button
              type="submit"
              size="sm"
              variant={publicado ? "outline" : "accent"}
              disabled={publicando || despublicando || sucio}
              title={
                sucio
                  ? "Guarda el orden antes de publicar: si no, se publicaría lo anterior."
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

        {[guardado, ren, pub, despub].map((s, i) =>
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

      {lista.length === 0 && (
        <Card className="border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Este módulo todavía no tiene análisis que colocar. Aparecerán aquí en
            cuanto configures una pregunta en Inteligencia o el sistema los
            proponga.
          </p>
        </Card>
      )}

      <ul className="space-y-2">
        {lista.map((b) => (
          <li
            key={b.analysis}
            draggable
            onDragStart={(e) => {
              setArrastrado(b.analysis);
              e.dataTransfer.effectAllowed = "move";
              // Algunos navegadores no inician el arrastre sin datos puestos.
              e.dataTransfer.setData("text/plain", b.analysis);
            }}
            onDragEnd={() => {
              setArrastrado(null);
              setSobre(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (sobre !== b.analysis) setSobre(b.analysis);
            }}
            onDragLeave={() => setSobre((s) => (s === b.analysis ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              const desde = e.dataTransfer.getData("text/plain") || arrastrado;
              if (desde) mover(desde, b.analysis);
              setArrastrado(null);
              setSobre(null);
            }}
            className={cn(
              "flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 transition-colors",
              arrastrado === b.analysis && "opacity-40",
              sobre === b.analysis && arrastrado !== b.analysis
                ? "border-primary bg-primary/5"
                : "border-border",
              !b.active && "opacity-60",
            )}
          >
            <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing" />

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "text-sm font-medium",
                    !b.active && "text-muted-foreground line-through",
                  )}
                >
                  {b.label}
                </span>
                <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {KIND_LABEL[b.kind] ?? b.kind}
                </span>
                {b.source === "system" && (
                  <span className="text-[10px] text-primary">propuesto por el sistema</span>
                )}
              </div>
              {/* Qué vigila, no solo su nombre: apagar «Avisos de cuentas por
                  pagar» sin saber que ahí van los anticipos sin imputar es
                  apagar algo a ciegas. */}
              <ul className="mt-1 text-xs text-muted-foreground">
                {b.watching.slice(0, 2).map((w) => (
                  <li key={w}>· {w}</li>
                ))}
              </ul>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {/* El ancho solo cuenta en un dashboard, y por eso vive aquí y no
                  en la configuración general de análisis. */}
              <div className="flex overflow-hidden rounded-md border border-border">
                {(["full", "half"] as const).map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => cambiar(b.analysis, { width: w })}
                    title={w === "full" ? "Fila completa" : "Media fila"}
                    aria-pressed={b.width === w}
                    className={cn(
                      "px-2 py-1.5 transition-colors",
                      b.width === w
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:bg-secondary/60",
                    )}
                  >
                    {w === "full" ? (
                      <Rows3 className="size-3.5" />
                    ) : (
                      <Columns2 className="size-3.5" />
                    )}
                  </button>
                ))}
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => cambiar(b.analysis, { active: !b.active })}
                title={b.active ? "Quitar del tablero" : "Poner en el tablero"}
              >
                {b.active ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {lista.length > 1 && (
        <p className="text-xs text-muted-foreground">
          Arrastra por el asa para reordenar. Los cambios no se guardan hasta que
          pulses «Guardar orden».
        </p>
      )}

      {/* Lo que se puede añadir. Va DESPUÉS del tablero y no antes: quien entra
          viene a acomodar lo que ya tiene, y una lista de opciones arriba
          empujaría eso fuera de la pantalla. */}
      {disponibles.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold">Agregar al tablero</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Análisis que existen y todavía no están aquí. Se agregan al final y
            luego se acomodan.
          </p>
          <div className="mt-3 grid gap-2">
            {disponibles.map((a) => (
              <Disponible key={a.id} modulo={modulo} a={a} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}


/**
 * Un análisis que se puede añadir.
 *
 * Con su `watching` a la vista: agregar algo llamado «Avisos de compras» sin
 * saber que ahí van las refacciones en falta y las órdenes atrasadas es agregar
 * a ciegas, y luego nadie sabe por qué el tablero enseña lo que enseña.
 */
function Disponible({
  modulo,
  a,
}: {
  modulo: string;
  a: { id: string; label: string; kind: string; watching: string[] };
}) {
  const [state, agregar, agregando] = useActionState(addToDashboardAction, inicial);

  return (
    <form action={agregar} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
      <input type="hidden" name="modulo" value={modulo} />
      <input type="hidden" name="analysis" value={a.id} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{a.label}</span>
          <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {KIND_LABEL[a.kind] ?? a.kind}
          </span>
        </div>
        <ul className="mt-1 text-xs text-muted-foreground">
          {a.watching.slice(0, 2).map((w) => (
            <li key={w}>· {w}</li>
          ))}
        </ul>
        {state.error && <p className="mt-1 text-xs text-destructive">{state.error}</p>}
      </div>
      <Button type="submit" variant="outline" size="sm" disabled={agregando}>
        {agregando ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
        Agregar
      </Button>
    </form>
  );
}
