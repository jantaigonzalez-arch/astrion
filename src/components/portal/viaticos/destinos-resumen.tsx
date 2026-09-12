import { DESTINO_LABELS, type TipoDestinoViatico } from "@/lib/viaticos";

/**
 * A DÓNDE VA UN VIAJE, en una línea: el contrato por su número y la empresa por
 * su nombre, cada uno con su tipo.
 *
 * Lo comparten el listado y el reporte. Desde la 0037 un viaje puede tener
 * varios destinos, y con dos pantallas pintándolos cada una a su manera, la
 * misma gira se leería distinto según dónde se mire.
 */
export function DestinosResumen({
  destinos,
}: {
  destinos: Array<{ tipo: TipoDestinoViatico; nombre: string }>;
}) {
  if (destinos.length === 0) return <span>—</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {destinos.map((d, i) => (
        <span key={`${d.tipo}-${d.nombre}-${i}`} className="inline-flex items-center gap-1">
          <span className={d.tipo === "contrato" ? "font-mono" : undefined}>{d.nombre}</span>
          {d.tipo !== "contrato" ? (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
              {DESTINO_LABELS[d.tipo].toLowerCase()}
            </span>
          ) : null}
        </span>
      ))}
    </span>
  );
}
