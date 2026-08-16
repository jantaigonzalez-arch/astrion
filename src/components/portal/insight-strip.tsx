"use client";

import { useSyncExternalStore } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  ChevronDown,
  Gauge,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Link } from "@/lib/nav";
import type { Insight, InsightTone } from "@/lib/ml/insights";
import { cn } from "@/lib/utils";

/**
 * Tira de hallazgos dentro del cuerpo de una página.
 *
 * NOTA: el asistente de la barra superior
 * (`components/portal/analysis-assistant.tsx`) es hoy el acceso principal al
 * análisis, y esta tira ya no se monta en ninguna pantalla. Se conserva porque
 * `InsightItem` —el renderizador de un hallazgo— vive aquí y lo usa el panel
 * del asistente, y porque una tira en contexto sigue teniendo sentido para una
 * pantalla que quiera enseñar SUS hallazgos sin obligar a abrir el panel.
 *
 * La regla de presencia CAMBIÓ al mover el análisis a la barra. Antes decía que
 * el distintivo no debía dibujarse sin hallazgos, porque su sola presencia era
 * la señal. Con un botón permanente esa regla se rompería sola, así que la
 * señal pasó al punto y al conteo: el botón siempre está, y solo se enciende
 * cuando hay algo. El objetivo de fondo no cambió —que la gente APRENDA EL
 * SÍMBOLO— y de hecho un sitio fijo lo cumple mejor que una aparición
 * intermitente.
 *
 * Lo que sí sigue valiendo: el pliegue no puede esconder lo urgente. El
 * disparador lleva el color y el conteo del hallazgo más grave, así que un
 * riesgo se ve sin abrir.
 */

/* ------------------------- La preferencia de pliegue ------------------------- */

/**
 * Si el panel va abierto o cerrado no es estado de un componente: es una
 * preferencia del usuario que vale para toda la aplicación. Modelarla como
 * almacén externo en vez de con `useState` + efecto da tres cosas de una:
 * no hay render en cascada al montar, dos tiras en la misma pantalla no se
 * contradicen, y abrirla en una pestaña la abre en las demás.
 */
const STORAGE_KEY = "evo:insights:abierto";
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // `storage` solo dispara en LAS OTRAS pestañas, nunca en la que escribe. Por
  // eso hace falta también el conjunto de oyentes local.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * Respaldo en memoria para cuando el navegador no deja escribir —modo privado,
 * almacenamiento bloqueado por política—. Sin esto el panel no abriría NUNCA en
 * esos navegadores: la escritura fallaría en silencio, los oyentes se
 * dispararían y la lectura devolvería el mismo valor de antes. Se pierde el
 * recuerdo entre pantallas, que es lo aceptable; no se pierde el botón.
 */
let memory = false;
let storageDenied = false;

function isOpen(): boolean {
  if (storageDenied) return memory;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    storageDenied = true;
    return memory;
  }
}

/** En el servidor siempre plegado, que es el estado con el que se hidrata. */
function isOpenOnServer(): boolean {
  return false;
}

function setOpen(next: boolean) {
  memory = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    storageDenied = true;
  }
  listeners.forEach((l) => l());
}

export function InsightStrip({
  insights,
  className,
}: {
  insights: Insight[];
  className?: string;
}) {
  const open = useSyncExternalStore(subscribe, isOpen, isOpenOnServer);
  const toggle = () => setOpen(!open);

  if (insights.length === 0) return null;

  const worst = mostSevere(insights);
  const tone = TONE[worst];
  const alerting = worst === "watch" || worst === "risk";

  return (
    <section aria-label="Análisis" className={cn("flex flex-col gap-3", className)}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="insight-panel"
        className={cn(
          "group inline-flex w-fit items-center gap-2 rounded-full border py-1.5 pl-2.5 pr-3 text-xs transition-colors",
          alerting
            ? cn(tone.border, tone.bg, "hover:brightness-105")
            : "border-border bg-secondary/40 hover:bg-secondary",
        )}
      >
        <span className="relative flex items-center">
          <Sparkles className={cn("size-4", alerting ? tone.text : "text-primary")} />
          {/* El punto es la única parte que se ve de reojo desde el otro lado
              de la pantalla. Solo aparece cuando hay algo que atender. */}
          {alerting && (
            <span
              className={cn(
                "absolute -right-0.5 -top-0.5 size-1.5 rounded-full ring-2 ring-card",
                worst === "risk" ? "bg-destructive" : "bg-warning",
              )}
            />
          )}
        </span>

        <span className={cn("font-medium", alerting ? tone.text : "text-foreground")}>
          Análisis
        </span>

        <span
          className={cn(
            "rounded-full px-1.5 font-mono text-[11px] tabular-nums",
            alerting ? cn(tone.bgStrong, tone.text) : "bg-border text-muted-foreground",
          )}
        >
          {insights.length}
        </span>

        <ChevronDown
          className={cn(
            "size-3.5 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          id="insight-panel"
          className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2"
        >
          {insights.map((i) => (
            <InsightItem key={i.id} insight={i} />
          ))}
        </div>
      )}
    </section>
  );
}

/** El más grave manda: es el que decide el color y el punto del distintivo. */
function mostSevere(insights: Insight[]): InsightTone {
  const order: InsightTone[] = ["risk", "watch", "good", "neutral"];
  return order.find((t) => insights.some((i) => i.tone === t)) ?? "neutral";
}

const TONE: Record<
  InsightTone,
  {
    icon: typeof Gauge;
    text: string;
    border: string;
    bg: string;
    bgStrong: string;
  }
> = {
  neutral: {
    icon: Gauge,
    text: "text-muted-foreground",
    border: "border-border",
    bg: "bg-secondary/40",
    bgStrong: "bg-border",
  },
  good: {
    icon: TrendingUp,
    text: "text-success",
    border: "border-success/40",
    bg: "bg-success/10",
    bgStrong: "bg-success/20",
  },
  watch: {
    icon: AlertTriangle,
    text: "text-warning",
    border: "border-warning/45",
    bg: "bg-warning/10",
    bgStrong: "bg-warning/20",
  },
  risk: {
    icon: AlertOctagon,
    text: "text-destructive",
    border: "border-destructive/45",
    bg: "bg-destructive/10",
    bgStrong: "bg-destructive/20",
  },
};

export function InsightItem({ insight }: { insight: Insight }) {
  const tone = TONE[insight.tone];
  const Icon = tone.icon;

  const body = (
    <div
      className={cn(
        "flex h-full items-start gap-3 rounded-md border bg-secondary/25 p-3",
        insight.tone === "neutral" ? "border-border" : tone.border,
        insight.href && "transition-colors hover:bg-secondary/60",
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone.text)} />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug">{insight.headline}</p>
        {/* La evidencia va SIEMPRE visible, no detrás de otro pliegue: quien
            abrió el panel vino justamente a poder discutir la afirmación. */}
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {insight.because}
        </p>
        {/* Cuántos casos la sostienen. Solo en estimaciones: un hecho medido no
            lleva soporte, y confundirlos sería darles la misma confianza. */}
        {insight.support !== null && (
          <p className="mt-1 font-mono text-[11px] text-muted-foreground tabular-nums">
            {insight.support} casos parecidos
          </p>
        )}
      </div>

      {insight.value && (
        <span
          className={cn(
            "shrink-0 font-mono text-lg font-semibold tabular-nums",
            tone.text,
          )}
        >
          {insight.value.n}
          <span className="ml-0.5 text-xs font-normal text-muted-foreground">
            {insight.value.unit}
          </span>
        </span>
      )}
    </div>
  );

  return insight.href ? (
    <Link href={insight.href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}
