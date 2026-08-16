"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Building2,
  ChevronRight,
  Maximize2,
  Minimize2,
  Phone,
  Plus,
  Search,
  X,
} from "lucide-react";
import { Link } from "@/lib/nav";
import { ORG_KIND_LABELS, ORG_KIND_STYLES, label, type OrgKind } from "@/lib/crm";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Selector de organización: un buscador en ventana, no una lista desplegable.
 *
 * El `<select>` que había aquí era correcto y a la vez inservible: 164
 * organizaciones en una tira que el sistema operativo pinta a su manera, sin
 * caja de búsqueda y sin más dato que el nombre. Para dar con «PROCTER & GAMBLE
 * MANUFACTURA S. DE R.L. DE C.V.» había que acertar la razón social de memoria
 * o desplazarse a ojo, y con dos empresas de nombre parecido no había forma de
 * saber cuál era cuál. El problema no era el orden de la lista: era no poder
 * buscar en ella.
 *
 * Tres decisiones de fondo:
 *
 * **Se busca por lo que la gente recuerda**, no por cómo se llama la ficha:
 * nombre, RFC, giro y teléfono. Facturación busca por RFC; quien acaba de
 * colgar el teléfono, por el número entrante.
 *
 * **Cada fila dice si ya es cliente**, con sus negocios abiertos y ganados. Es
 * la diferencia entre abrir una oportunidad con quien ya te compró y con quien
 * hay que convencer, y decidirlo mirando solo un nombre es adivinar.
 *
 * **La ventana crece.** Empieza como diálogo y se expande a pantalla completa;
 * para trabajar de verdad sobre la cartera —depurar duplicados, reasignar
 * responsables— está el enlace al catálogo, que es esa misma pantalla con todo
 * lo que aquí no cabe.
 */

export type OrgPick = {
  id: string;
  name: string;
  kind: OrgKind;
  taxId?: string | null;
  industry?: string | null;
  phone?: string | null;
  openDeals?: number;
  wonDeals?: number;
};

type PickerProps = {
  orgs: OrgPick[];
  value: string;
  onPick: (id: string) => void;
  /**
   * Abre el alta rápida con el nombre ya tecleado. El diálogo se cierra antes.
   *
   * Que arrastre la búsqueda no es un adorno: se llega a «crear» justamente
   * después de escribir un nombre y no encontrarlo, y hacer que el usuario lo
   * vuelva a teclear es pedirle que repita el trabajo que acaba de hacer.
   */
  onCreateNew: (name: string) => void;
  locale: string;
  open: boolean;
  onClose: () => void;
};

/** Tope de filas dibujadas. Ver la nota en `visible`. */
const MAX_ROWS = 80;

/** Sin acentos y en minúsculas: «farmaceutica» debe encontrar «Farmacéutica». */
const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Envoltura: mientras está cerrado no hay NADA montado.
 *
 * Y de ahí sale gratis el comportamiento correcto al reabrir. El cuerpo guarda
 * la búsqueda, el filtro y el cursor en estado propio; como se desmonta al
 * cerrar, cada apertura empieza en blanco sin un solo efecto que "limpie" lo
 * anterior. Reiniciar estado con un `useEffect` es la versión frágil de esto
 * mismo: se ejecuta un render tarde y deja ver por un instante la búsqueda
 * pasada.
 *
 * También evita tocar `document` durante el render del servidor, donde no
 * existe: el diálogo solo aparece por acción del usuario.
 */
export function OrgPicker(props: PickerProps) {
  if (!props.open) return null;
  return createPortal(<PickerDialog {...props} />, document.body);
}

function PickerDialog({
  orgs,
  value,
  onPick,
  onCreateNew,
  locale,
  onClose,
}: PickerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all" | OrgKind>("all");
  const [expanded, setExpanded] = useState(false);
  const [cursor, setCursor] = useState(0);

  /*
    `showModal()` y no una capa propia con `position: fixed`.

    El elemento nativo trae resueltas cuatro cosas que a mano salen mal casi
    siempre: atrapa el foco dentro del diálogo, cierra con Escape, marca inerte
    todo lo de atrás para el lector de pantalla, y se dibuja en la capa superior
    del navegador —así que no compite con ningún `z-index` de la aplicación—.

    El foco se pone a mano después. `showModal()` lo lleva al primer elemento
    enfocable, que aquí es el botón de expandir del encabezado: quien abriera el
    selector y empezara a teclear no vería aparecer una sola letra, que es justo
    lo que este selector existe para evitar.
  */
  useEffect(() => {
    dialogRef.current?.showModal();
    searchRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    const term = norm(q.trim());
    return orgs.filter((o) => {
      if (kind !== "all" && o.kind !== kind) return false;
      if (!term) return true;
      return norm(
        [o.name, o.taxId, o.industry, o.phone].filter(Boolean).join(" "),
      ).includes(term);
    });
  }, [orgs, q, kind]);

  /*
    Se dibujan como mucho `MAX_ROWS` filas, y cuando se recorta SE DICE.

    Un corte silencioso es peor que una lista larga: quien no ve su
    organización concluye que no existe y la da de alta otra vez, y duplicar una
    ficha es de lo más caro de deshacer en un CRM —los negocios quedan
    repartidos entre las copias—.
  */
  const visible = results.slice(0, MAX_ROWS);
  const hidden = results.length - visible.length;

  /*
    El cursor vuelve al primer resultado cuando cambia la búsqueda, ajustándose
    DURANTE el render y no en un efecto.

    Con un efecto habría un render intermedio en el que la lista ya es la nueva
    y el resaltado sigue apuntando a la fila del listado anterior: pulsar Enter
    en ese instante elige una organización que el usuario no está viendo.
  */
  const filterKey = `${q}|${kind}`;
  const [prevKey, setPrevKey] = useState(filterKey);
  if (prevKey !== filterKey) {
    setPrevKey(filterKey);
    setCursor(0);
  }

  function choose(id: string) {
    onPick(id);
    onClose();
  }

  function createFrom(name: string) {
    onClose();
    onCreateNew(name.trim());
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const max = visible.length - 1;
      const next = e.key === "ArrowDown" ? cursor + 1 : cursor - 1;
      const clamped = next < 0 ? 0 : next > max ? max : next;
      setCursor(clamped);
      // Lo resaltado tiene que verse: sin esto, bajar con el teclado mueve la
      // selección fuera de la vista y parece que no pasa nada.
      listRef.current
        ?.querySelectorAll("li[data-row]")
        [clamped]?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const hit = visible[cursor];
      if (hit) choose(hit.id);
    }
  }

  const clientes = orgs.filter((o) => o.kind === "client").length;
  const leads = orgs.length - clientes;

  return (
    /*
      El diálogo se monta en `document.body`, FUERA del formulario del negocio.

      No es cosmético. Dentro del formulario, sus campos viajarían en el envío
      del negocio, y pulsar Enter en la caja de búsqueda enviaría ese formulario
      en vez de elegir la organización resaltada. Portarlo al `body` elimina las
      dos cosas de raíz en lugar de irlas parcheando.
    */
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={onClose}
      onClick={(e) => {
        // Clic en el fondo. El backdrop es parte del propio <dialog>, así que
        // el clic llega con el diálogo como destino; el contenido va dentro de
        // un hijo, y por eso este descarte no se traga los clics de las filas.
        if (e.target === dialogRef.current) onClose();
      }}
      className={cn(
        "m-auto w-[calc(100vw-2rem)] rounded-2xl border border-border bg-card p-0 text-card-foreground shadow-2xl backdrop:bg-black/50",
        expanded ? "h-[calc(100vh-2rem)] max-w-6xl" : "max-h-[80vh] max-w-3xl",
      )}
      aria-label="Elegir organización"
    >
      <div className="flex h-full max-h-[inherit] flex-col">
        {/* Encabezado */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Building2 className="size-4 shrink-0 text-primary" />
          <h2 className="text-sm font-semibold">Elegir organización</h2>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {clientes} cliente(s) · {leads} lead(s)
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              aria-label={expanded ? "Reducir la ventana" : "Expandir la ventana"}
              title={expanded ? "Reducir" : "Expandir"}
            >
              {expanded ? (
                <Minimize2 className="size-4" />
              ) : (
                <Maximize2 className="size-4" />
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              aria-label="Cerrar"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Búsqueda y filtros */}
        <div className="space-y-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Buscar por nombre, RFC, giro o teléfono…"
              className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              aria-label="Buscar organización"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Limpiar búsqueda"
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ["all", `Todas (${orgs.length})`],
                ["client", `Clientes (${clientes})`],
                ["lead", `Leads (${leads})`],
              ] as const
            ).map(([k, txt]) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  kind === k
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground hover:text-foreground",
                )}
              >
                {txt}
              </button>
            ))}
            <button
              type="button"
              onClick={() => createFrom(q)}
              className="ml-auto inline-flex items-center gap-1 rounded-full border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
            >
              <Plus className="size-3" /> Crear nueva
            </button>
          </div>
        </div>

        {/* Resultados */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {visible.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
              <Building2 className="size-9 text-primary" />
              <p className="max-w-sm text-sm text-muted-foreground">
                {q
                  ? `Ninguna organización coincide con «${q}».`
                  : "No hay organizaciones con este filtro."}
              </p>
              <button
                type="button"
                onClick={() => createFrom(q)}
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                <Plus className="size-3.5" />
                {q ? `Crear «${q.trim()}»` : "Crear una nueva organización"}
              </button>
            </div>
          ) : (
            <ul ref={listRef} className="divide-y divide-border">
              {/* Quitar la organización, solo cuando hay una puesta. */}
              {value && (
                <li>
                  <button
                    type="button"
                    onClick={() => choose("")}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary/60"
                  >
                    <X className="size-3.5" /> Sin organización
                  </button>
                </li>
              )}
              {visible.map((o, i) => (
                <li key={o.id} data-row>
                  <button
                    type="button"
                    onClick={() => choose(o.id)}
                    onMouseEnter={() => setCursor(i)}
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors",
                      i === cursor ? "bg-secondary/70" : "hover:bg-secondary/40",
                      o.id === value && "ring-1 ring-inset ring-primary/40",
                    )}
                    aria-current={o.id === value}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">{o.name}</span>
                        <Badge className={cn("shrink-0", ORG_KIND_STYLES[o.kind])}>
                          {label(ORG_KIND_LABELS, o.kind, locale)}
                        </Badge>
                      </div>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        {o.industry && <span>{o.industry}</span>}
                        {o.taxId && <span className="font-mono">{o.taxId}</span>}
                        {o.phone && (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="size-3" />
                            {o.phone}
                          </span>
                        )}
                        {!o.industry && !o.taxId && !o.phone && (
                          <span>Sin datos de ficha</span>
                        )}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-[11px] text-muted-foreground">
                      {(o.wonDeals ?? 0) > 0 && (
                        <div className="text-success">{o.wonDeals} ganado(s)</div>
                      )}
                      {(o.openDeals ?? 0) > 0 && <div>{o.openDeals} abierto(s)</div>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Pie */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          <span>
            {hidden > 0 ? (
              <>
                Mostrando {visible.length} de {results.length} — escribe para afinar.
              </>
            ) : (
              <>
                {results.length} resultado(s) ·{" "}
                <kbd className="rounded border border-border px-1">↑</kbd>{" "}
                <kbd className="rounded border border-border px-1">↓</kbd> para
                moverte, <kbd className="rounded border border-border px-1">Enter</kbd>{" "}
                para elegir
              </>
            )}
          </span>
          {/*
            La cartera completa, con lo que aquí no cabe: responsables, montos
            abiertos, edición y alta con ficha completa. Se abre en otra pestaña
            a propósito — el negocio a medio capturar sigue vivo en ésta.
          */}
          <Link
            href="/admin/crm/organizaciones"
            target="_blank"
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            Abrir el catálogo completo <ChevronRight className="size-3" />
          </Link>
        </div>
      </div>
    </dialog>
  );
}
