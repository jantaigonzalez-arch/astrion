"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, Building2, GripVertical, Loader2, User2 } from "lucide-react";
import { Link } from "@/lib/nav";
import { moveDeal } from "@/lib/actions/crm";
import { LABEL_STYLES, daysIdle, isRotting, money, weightedValue } from "@/lib/crm";
import { cn } from "@/lib/utils";

export type BoardDeal = {
  id: string;
  reference: string;
  title: string;
  stageId: string;
  valueMxn: string | null;
  /** Importe en dólares tal como se capturó, para poder rotularlo. */
  valueUsd: string | null;
  /**
   * Importe comparable en pesos, calculado en la base: el de pesos si lo hay,
   * si no el de dólares por el tipo de cambio estampado en el negocio. `null`
   * cuando es un negocio en dólares y la empresa no tenía tipo de cambio
   * configurado — ese caso se rotula, no se suma como cero.
   */
  valorMxn: string | null;
  expectedCloseDate: string | null;
  updatedAt: Date | string;
  organization: { id: string; name: string } | null;
  contact: { id: string; name: string } | null;
  owner: { id: string; name: string | null; email: string } | null;
  labelLinks: { label: { id: string; name: string; color: string } }[];
};

export type BoardColumn = {
  stage: {
    id: string;
    name: string;
    probability: number;
    rottingDays: number;
  };
  deals: BoardDeal[];
};

/**
 * Tablero del embudo. El arrastre usa la API nativa de HTML5 (sin librerías):
 * al soltar se llama al server action `moveDeal`, y mientras tanto la columna
 * se actualiza de forma optimista para que no haya parpadeo.
 */
export function PipelineBoard({
  columns,
  locale,
}: {
  columns: BoardColumn[];
  locale: string;
}) {
  // Firma del orden que llega del servidor: si cambia, se resincroniza el
  // estado local (patrón de "reset de estado al cambiar props" de React).
  const signature = useMemo(
    () =>
      columns
        .map((c) => `${c.stage.id}:${c.deals.map((d) => d.id).join(",")}`)
        .join("|"),
    [columns],
  );
  const [prevSignature, setPrevSignature] = useState(signature);
  const [cols, setCols] = useState(columns);
  if (signature !== prevSignature) {
    setPrevSignature(signature);
    setCols(columns);
  }

  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ stageId: string; index: number } | null>(null);
  const [pending, startTransition] = useTransition();

  const fmtDate = (d: string | null) =>
    d
      ? new Date(d + "T00:00:00").toLocaleDateString(
          locale === "en" ? "en-US" : "es-MX",
          { day: "2-digit", month: "short" },
        )
      : null;

  function drop(stageId: string, index: number) {
    const dealId = dragging;
    setDragging(null);
    setOver(null);
    if (!dealId) return;

    // Reordena localmente antes de que responda el servidor.
    const next = cols.map((c) => ({ ...c, deals: [...c.deals] }));
    let moved: BoardDeal | undefined;
    for (const c of next) {
      const i = c.deals.findIndex((d) => d.id === dealId);
      if (i >= 0) {
        moved = c.deals.splice(i, 1)[0];
        break;
      }
    }
    if (!moved) return;
    const target = next.find((c) => c.stage.id === stageId);
    if (!target) return;
    const at = Math.max(0, Math.min(index, target.deals.length));
    target.deals.splice(at, 0, { ...moved, stageId });
    setCols(next);

    const fd = new FormData();
    fd.set("dealId", dealId);
    fd.set("stageId", stageId);
    fd.set("index", String(at));
    startTransition(() => {
      void moveDeal(fd);
    });
  }

  return (
    <div className="relative">
      {pending && (
        <div className="absolute right-0 -top-8 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Guardando…
        </div>
      )}

      <div className="flex gap-4 overflow-x-auto pb-4">
        {cols.map((col) => {
          // Se suma el valor COMPARABLE, no el de pesos: antes un negocio en
          // dólares aportaba cero a la columna y a nadie se le avisaba.
          const total = col.deals.reduce(
            (acc, d) => acc + Number(d.valorMxn ?? 0),
            0,
          );
          const weighted = col.deals.reduce(
            (acc, d) => acc + weightedValue(d.valorMxn, col.stage.probability),
            0,
          );
          // Los que no se pueden convertir se cuentan aparte para decirlo.
          const sinConvertir = col.deals.filter(
            (d) => !d.valorMxn && d.valueUsd,
          ).length;
          const isOverEnd =
            over?.stageId === col.stage.id && over.index >= col.deals.length;

          return (
            <section
              key={col.stage.id}
              onDragOver={(e) => {
                e.preventDefault();
                setOver({ stageId: col.stage.id, index: col.deals.length });
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(col.stage.id, col.deals.length);
              }}
              className={cn(
                "flex w-72 shrink-0 flex-col rounded-2xl border border-border bg-secondary/30 transition-colors",
                over?.stageId === col.stage.id && "border-primary/50 bg-primary/5",
              )}
            >
              {/* Encabezado de la etapa */}
              <header className="border-b border-border/70 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="truncate text-sm font-semibold">
                    {col.stage.name}
                  </h3>
                  <span className="shrink-0 rounded-full bg-background px-2 py-0.5 font-mono text-[11px] text-muted-foreground ring-1 ring-inset ring-border">
                    {col.deals.length}
                  </span>
                </div>
                <div className="mt-1.5 flex items-baseline justify-between gap-2">
                  <span className="font-mono text-sm font-semibold text-gradient-brand">
                    {money(String(total), "MXN", locale)}
                  </span>
                  <span
                    className="text-[11px] text-muted-foreground"
                    title="Valor ponderado por la probabilidad de la etapa"
                  >
                    {col.stage.probability}% · {money(String(weighted), "MXN", locale)}
                  </span>
                </div>
                {/*
                  El total de arriba no incluye estos negocios, y decirlo es
                  media función: un número que se queda corto en silencio es
                  peor que uno acompañado de «faltan dos por convertir».
                */}
                {sinConvertir > 0 && (
                  <p
                    className="mt-1 text-[11px] font-medium text-warning"
                    title="Están en dólares y no hay tipo de cambio configurado, así que no entran en el total. Se fija en Configuración → Moneda."
                  >
                    +{sinConvertir} en USD sin convertir
                  </p>
                )}
              </header>

              {/* Tarjetas */}
              <div className="flex-1 space-y-2 p-2">
                {col.deals.map((deal, i) => {
                  const isOverHere =
                    over?.stageId === col.stage.id && over.index === i;
                  const rotting = isRotting(deal.updatedAt, col.stage.rottingDays);
                  return (
                    <div key={deal.id}>
                      {isOverHere && (
                        <div className="mb-2 h-1 rounded-full bg-primary/60" />
                      )}
                      <article
                        draggable
                        onDragStart={(e) => {
                          setDragging(deal.id);
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", deal.id);
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setOver(null);
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setOver({ stageId: col.stage.id, index: i });
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          drop(col.stage.id, i);
                        }}
                        className={cn(
                          "group rounded-xl border bg-card p-3 shadow-sm transition-all hover:border-primary/40 hover:shadow-md",
                          rotting
                            ? "border-destructive/50"
                            : "border-border",
                          dragging === deal.id && "opacity-40",
                        )}
                      >
                        {deal.labelLinks.length > 0 && (
                          <div className="mb-2 flex flex-wrap gap-1">
                            {deal.labelLinks.map(({ label: l }) => (
                              <span
                                key={l.id}
                                className={cn(
                                  "rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset",
                                  LABEL_STYLES[l.color] ?? LABEL_STYLES.primary,
                                )}
                              >
                                {l.name}
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="flex items-start gap-2">
                          <GripVertical className="mt-0.5 size-3.5 shrink-0 cursor-grab text-muted-foreground/60 active:cursor-grabbing" />
                          <div className="min-w-0 flex-1">
                            <Link
                              href={`/admin/crm/negocios/${deal.id}`}
                              className="block truncate text-sm font-medium hover:text-primary"
                            >
                              {deal.title}
                            </Link>
                            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                              {deal.reference}
                            </p>
                          </div>
                        </div>

                        <p className="mt-2 font-mono text-sm font-semibold">
                          {deal.valorMxn
                            ? money(deal.valorMxn, "MXN", locale)
                            : deal.valueUsd
                              ? money(deal.valueUsd, "USD", locale)
                              : "—"}
                          {/* Un negocio convertido dice en qué moneda se pactó:
                              el número en pesos es derivado y quien lo mira
                              tiene derecho a saberlo. */}
                          {deal.valueUsd && deal.valorMxn && (
                            <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                              USD
                            </span>
                          )}
                          {deal.valueUsd && !deal.valorMxn && (
                            <span
                              className="ml-1 text-[10px] font-normal text-warning"
                              title="Falta el tipo de cambio: fíjalo en Configuración → Moneda para que este negocio sume al embudo."
                            >
                              sin convertir
                            </span>
                          )}
                        </p>

                        {rotting && (
                          <p
                            className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-destructive"
                            title={`Sin movimiento desde hace ${daysIdle(deal.updatedAt)} días (límite: ${col.stage.rottingDays})`}
                          >
                            <AlertTriangle className="size-3" />
                            Estancado {daysIdle(deal.updatedAt)} d
                          </p>
                        )}

                        <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                          {deal.organization && (
                            <p className="flex items-center gap-1.5 truncate">
                              <Building2 className="size-3 shrink-0" />
                              {deal.organization.name}
                            </p>
                          )}
                          {deal.contact && (
                            <p className="flex items-center gap-1.5 truncate">
                              <User2 className="size-3 shrink-0" />
                              {deal.contact.name}
                            </p>
                          )}
                        </div>

                        {(deal.expectedCloseDate || deal.owner) && (
                          <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
                            <span className="truncate">
                              {deal.owner?.name ?? deal.owner?.email ?? "Sin dueño"}
                            </span>
                            {deal.expectedCloseDate && (
                              <span className="shrink-0 font-mono">
                                {fmtDate(deal.expectedCloseDate)}
                              </span>
                            )}
                          </div>
                        )}
                      </article>
                    </div>
                  );
                })}

                {isOverEnd && <div className="h-1 rounded-full bg-primary/60" />}

                {col.deals.length === 0 && (
                  <p className="rounded-xl border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">
                    Arrastra negocios aquí
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
