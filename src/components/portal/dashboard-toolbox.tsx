"use client";

import { GripVertical, Plus, Sparkles, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type HerramientaItem = {
  id: string;
  label: string;
  kind: string;
  watching: string[];
  /** Cuántos bloques produce hoy. Cero = configurado pero sin nada que decir. */
  piezas: number;
};

const KIND_LABEL: Record<string, string> = {
  finding: "Requiere atención",
  projection: "Lo que viene",
  trend: "Cómo viene",
  forecast: "Lo que estima un modelo",
};

/**
 * La caja de herramientas del compositor: lo que se puede poner en el tablero.
 *
 * ── ACOPLADA AL COSTADO, NO ENCIMA ─────────────────────────────────────────
 *
 * El panel de Análisis de la barra superior es una superposición que tapa el
 * contenido, y para leer está bien. Esto no puede serlo: de aquí se ARRASTRA
 * hacia el tablero, así que la caja y el destino tienen que verse a la vez. Una
 * superposición obligaría a cerrarla para soltar, que es justo el gesto que se
 * quiere evitar.
 *
 * Por eso es una columna angosta y pegajosa —320 px— y no media pantalla: lo
 * que importa es el tablero, y la caja es de donde se saca. En pantallas
 * estrechas baja debajo, porque a ese ancho dos columnas dejan las dos
 * inservibles.
 *
 * ── ESTABA ABAJO Y ESO ERA EL PROBLEMA ─────────────────────────────────────
 *
 * La lista de disponibles vivía al final de la página, después de todos los
 * bloques. Con un tablero de ocho, agregar el noveno exigía recorrer el tablero
 * entero hasta el fondo, y volver a subir para ver dónde cayó. Al costado se
 * ven las dos cosas sin desplazarse.
 *
 * ── DOS SECCIONES, PORQUE SON DOS COSAS ────────────────────────────────────
 *
 * «Disponibles» es lo que existe y nunca estuvo aquí. «Quitados» es lo que
 * alguien apagó, y sigue existiendo a propósito: apagar no es borrar, y esa
 * distinción se perdería si un bloque apagado desapareciera sin dejar rastro.
 */
export function DashboardToolbox({
  disponibles,
  quitados,
  onAgregar,
  onArrastrar,
  onSoltarFuera,
  arrastrando,
}: {
  disponibles: HerramientaItem[];
  quitados: HerramientaItem[];
  /** Al pulsar «+»: entra al final del tablero, encendido. */
  onAgregar: (id: string, desde: "disponible" | "quitado") => void;
  onArrastrar: (id: string, desde: "disponible" | "quitado" | null) => void;
  /** Soltar un bloque del tablero AQUÍ lo quita, sin borrarlo. */
  onSoltarFuera: (id: string) => void;
  arrastrando: { id: string; desde: "tablero" | "disponible" | "quitado" } | null;
}) {
  const recibeDelTablero = arrastrando?.desde === "tablero";

  return (
    <aside
      onDragOver={(e) => {
        if (!recibeDelTablero) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        if (!recibeDelTablero) return;
        e.preventDefault();
        onSoltarFuera(arrastrando.id);
      }}
      className={cn(
        // Pegajosa: acomodar un tablero largo es desplazarse por él, y una caja
        // que se va hacia arriba obliga a volver por cada bloque que se agrega.
        "lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]",
        "flex flex-col overflow-hidden rounded-xl border bg-card transition-colors",
        recibeDelTablero ? "border-destructive/50 bg-destructive/5" : "border-border",
      )}
    >
      <div className="border-b border-border px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-primary" /> Caja de herramientas
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {recibeDelTablero
            ? "Suelta aquí para quitarlo del tablero."
            : "Arrastra al tablero, o pulsa + para ponerlo al final."}
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <Seccion
          titulo="Disponibles"
          vacio="Ya está todo en el tablero."
          items={disponibles}
          desde="disponible"
          onAgregar={onAgregar}
          onArrastrar={onArrastrar}
        />
        {quitados.length > 0 && (
          <Seccion
            titulo="Quitados de este tablero"
            ayuda="Siguen existiendo: apagar no es borrar."
            vacio=""
            items={quitados}
            desde="quitado"
            onAgregar={onAgregar}
            onArrastrar={onArrastrar}
          />
        )}
      </div>
    </aside>
  );
}

function Seccion({
  titulo,
  ayuda,
  vacio,
  items,
  desde,
  onAgregar,
  onArrastrar,
}: {
  titulo: string;
  ayuda?: string;
  vacio: string;
  items: HerramientaItem[];
  desde: "disponible" | "quitado";
  onAgregar: (id: string, desde: "disponible" | "quitado") => void;
  onArrastrar: (id: string, desde: "disponible" | "quitado" | null) => void;
}) {
  return (
    <div>
      <p className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {titulo}
      </p>
      {ayuda && <p className="px-1 pt-0.5 text-[11px] text-muted-foreground">{ayuda}</p>}

      {items.length === 0 ? (
        <p className="px-1 pt-2 text-xs text-muted-foreground">{vacio}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items.map((a) => (
            <li
              key={a.id}
              draggable
              onDragStart={(e) => {
                onArrastrar(a.id, desde);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", a.id);
              }}
              onDragEnd={() => onArrastrar(a.id, null)}
              className={cn(
                "group flex cursor-grab items-start gap-2 rounded-lg border border-border",
                "bg-background p-2.5 transition-colors hover:border-primary/50 active:cursor-grabbing",
              )}
            >
              <GripVertical className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium leading-snug">{a.label}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {KIND_LABEL[a.kind] ?? a.kind}
                  {/* Cuántos bloques trae HOY. Un análisis configurado que hoy
                      no encuentra nada se puede colocar igual —mañana dirá
                      algo— pero quien compone tiene que saber que ahora mismo
                      no va a ver nada aparecer. */}
                  {a.piezas === 0 && " · hoy sin datos"}
                </p>
                {/* Qué vigila, no solo su nombre: poner «Avisos de compras» sin
                    saber que ahí van las refacciones en falta es poner algo a
                    ciegas. Una sola línea, que la caja es angosta. */}
                {a.watching[0] && (
                  <p className="mt-1 truncate text-[10px] text-muted-foreground/80">
                    · {a.watching[0]}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onAgregar(a.id, desde)}
                title={desde === "quitado" ? "Volver a poner" : "Agregar al final"}
                className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
              >
                {desde === "quitado" ? (
                  <Undo2 className="size-3.5" />
                ) : (
                  <Plus className="size-3.5" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
