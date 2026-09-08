import { Plane } from "lucide-react";
import { Card } from "@/components/ui/card";
import { CATEGORIA_LABELS, mxnViatico, type ViaticoCategoria } from "@/lib/viaticos";

/**
 * LO QUE COSTÓ IR, en la ficha de un prospecto o de un negocio.
 *
 * ── POR QUÉ ESTO EXISTE COMO COMPONENTE Y NO COMO DOS BLOQUES ──────────────
 *
 * Porque el contrato ya tenía el suyo escrito a mano dentro de su página, y con
 * la 0028 aparecieron dos sitios más que enseñan exactamente lo mismo —total,
 * número de viajes y desglose por categoría—. Tres copias del mismo bloque es
 * donde una se queda sin el renglón nuevo cuando alguien añade una categoría.
 *
 * El del contrato NO se migra aquí: allá el costo de viaje es un renglón dentro
 * del cálculo de utilidad, entre refacciones y mano de obra, y sacarlo a una
 * tarjeta aparte rompería la única lectura que esa pantalla tiene que permitir
 * —qué compone el margen—. Es el mismo dato contestando dos preguntas distintas.
 *
 * ── SOLO CUENTA LO CERRADO ────────────────────────────────────────────────
 *
 * Y eso se dice en la pantalla, no solo en el código. Un anticipo autorizado
 * todavía no es un costo: es dinero entregado que puede volver. Sin la nota,
 * quien mira una cifra baja en un negocio con dos viajes en curso concluiría
 * que viajar sale barato.
 */
export function CostoDeViaje({
  viajes,
  costo,
  porCategoria,
  titulo,
  pieVacio,
}: {
  viajes: number;
  costo: number;
  porCategoria: Array<{ k: ViaticoCategoria; total: number }>;
  titulo: string;
  /** Qué decir cuando no hay ningún viaje cerrado todavía. */
  pieVacio: string;
}) {
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <Plane className="size-4 text-primary" />
        {titulo}
      </h2>

      {viajes === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{pieVacio}</p>
      ) : (
        <>
          <div className="mt-3 flex items-baseline justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              {viajes} viaje{viajes === 1 ? "" : "s"} cerrado
              {viajes === 1 ? "" : "s"}
            </span>
            <span className="text-xl font-semibold tabular-nums">
              {mxnViatico(costo)}
            </span>
          </div>

          {porCategoria.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
              {porCategoria.map((c) => (
                <span
                  key={c.k}
                  className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground"
                >
                  {CATEGORIA_LABELS[c.k]}{" "}
                  <span className="font-medium tabular-nums text-foreground">
                    {mxnViatico(c.total)}
                  </span>
                </span>
              ))}
            </div>
          ) : null}

          <p className="mt-3 text-xs text-muted-foreground">
            Solo cuenta lo comprobado y cerrado. Un anticipo autorizado todavía
            no es un costo.
          </p>
        </>
      )}
    </Card>
  );
}
