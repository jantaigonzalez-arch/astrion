import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Minus } from "lucide-react";
import { Link } from "@/lib/nav";
import type { Alerta, Kpi } from "@/lib/data/panel";

/**
 * LA FRANJA DE ALERTAS Y LAS TARJETAS DE INDICADOR.
 *
 * Componentes de SERVIDOR: no llevan interacción, así que no viaja ni una línea
 * de JavaScript al navegador por ellos. La línea de tendencia es un SVG estático
 * de doce puntos; lo que se puede hacer con ella —mirar el detalle— se hace
 * entrando a la pantalla que la tarjeta enlaza, que es la revelación progresiva
 * que pide un panel: resumen arriba, detalle a un clic.
 */

/* ────────────────────────────────────────────────────────────────────────────
   ALERTAS
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Lo que está mal AHORA, arriba del todo y con qué hacer al respecto.
 *
 * ── POR QUÉ NO SE ENSEÑAN LOS CEROS ────────────────────────────────────────
 *
 * Un panel que dibuja cuatro tarjetas en verde diciendo «0 vencidos, 0 sin
 * asignar, 0 fuera de plazo» enseña a no mirarlo: si casi siempre está todo en
 * verde, el ojo deja de pasar por ahí y el día que una se pone roja tampoco la
 * ve. Las alertas aparecen SOLO cuando hay algo, y cuando no hay nada el panel
 * lo dice en un renglón y se calla.
 *
 * ── DOS TONOS, NO CINCO ────────────────────────────────────────────────────
 *
 * `critica` es «hoy» y `atencion` es «esta semana». Más niveles obligan a
 * aprenderse una escala, y una escala que hay que aprenderse no se usa. El color
 * NUNCA va solo: cada alerta lleva su icono y su texto, que es lo que la hace
 * legible en escala de grises y para quien no distingue el rojo del ámbar.
 */
export function FranjaAlertas({ alertas }: { alertas: Alerta[] }) {
  if (alertas.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-success/25 bg-success/5 px-4 py-3 text-sm">
        <CheckCircle2 className="size-4 shrink-0 text-success" />
        <span className="text-muted-foreground">
          Nada pendiente: sin tickets fuera de plazo, sin solicitudes sin revisar y sin
          facturas vencidas.
        </span>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {alertas.map((a) => {
        const critica = a.tono === "critica";
        return (
          <Link
            key={a.clave}
            href={a.href}
            className={[
              "group flex items-start gap-3 rounded-xl border p-4 transition-colors",
              critica
                ? "border-destructive/30 bg-destructive/5 hover:bg-destructive/10"
                : "border-warning/30 bg-warning/5 hover:bg-warning/10",
            ].join(" ")}
          >
            <AlertTriangle
              className={`mt-0.5 size-4 shrink-0 ${critica ? "text-destructive" : "text-warning"}`}
            />
            <div className="min-w-0">
              <p className={`text-sm font-medium ${critica ? "text-destructive" : "text-warning"}`}>
                {a.titulo}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{a.detalle}</p>
              {a.importe !== undefined && (
                <p className="mt-1 text-sm font-semibold">
                  {dinero(a.importe, a.moneda ?? "MXN")}
                </p>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   INDICADORES
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Doce puntos, dos píxeles, sin ejes.
 *
 * Es contexto, no una gráfica: contesta «¿viene subiendo o bajando?» y nada
 * más. Por eso no lleva rejilla, ni escala, ni etiquetas — todo eso compite con
 * el número, que es lo que la tarjeta viene a decir.
 *
 * El trazo va en el tono de de-énfasis y SOLO el último punto en el color de
 * acento, que es donde está el valor que la tarjeta muestra. Pintarla entera de
 * color la convertiría en la protagonista.
 */
function Chispa({ serie, etiqueta }: { serie: number[]; etiqueta: string }) {
  if (serie.length < 2) return <div className="h-8" />;

  const min = Math.min(...serie);
  const max = Math.max(...serie);
  const rango = max - min || 1;
  const W = 120;
  const H = 32;

  const punto = (v: number, i: number) => {
    const x = (i / (serie.length - 1)) * W;
    // El SVG crece hacia abajo: el valor alto tiene que quedar arriba.
    const y = H - ((v - min) / rango) * (H - 4) - 2;
    return [x, y] as const;
  };

  const d = serie.map((v, i) => `${i === 0 ? "M" : "L"}${punto(v, i).join(" ")}`).join(" ");
  const [ux, uy] = punto(serie[serie.length - 1], serie.length - 1);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="viz-root h-8 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={`${etiqueta}: tendencia de los últimos ${serie.length} meses`}
    >
      <title>{`${etiqueta} · ${serie.length} meses`}</title>
      <path
        d={d}
        fill="none"
        stroke="var(--viz-track)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* El punto de ahora, en acento: es el que la cifra de arriba está diciendo. */}
      <circle cx={ux} cy={uy} r={2.5} fill="var(--series-1)" />
    </svg>
  );
}

/** `1 284` · `12.9 K` · `$4.2 M`. Compacto para que quepa sin encoger la letra. */
function compacto(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)} M`;
  if (abs >= 10_000) return `${(v / 1000).toFixed(1)} K`;
  return Math.round(v).toLocaleString("es-MX");
}

function dinero(v: number, moneda = "MXN"): string {
  return `$${compacto(v)} ${moneda}`;
}

/**
 * Una tarjeta de indicador: etiqueta, valor, variación y tendencia.
 *
 * ── EL COLOR DEL DELTA NO SALE DEL SIGNO ───────────────────────────────────
 *
 * Sale de si subir es bueno PARA ESE indicador. Que la utilidad suba es verde;
 * que el saldo por pagar suba, no. Pintar todo lo positivo de verde es el error
 * clásico de los paneles financieros y hace que la deuda creciente se vea como
 * una buena noticia.
 *
 * ── EL VALOR VA CON CIFRAS PROPORCIONALES ──────────────────────────────────
 *
 * Y no `tabular-nums`, que es lo que tenía el panel anterior. Las tabulares dan
 * a cada dígito el ancho de un cero, y a tamaño grande un «121» se ve suelto y
 * mal espaciado. Las tabulares se reservan para COLUMNAS de números que tienen
 * que alinearse: filas de una tabla, marcas de un eje.
 */
export function TarjetaKpi({ kpi }: { kpi: Kpi }) {
  const texto =
    kpi.formato === "dinero"
      ? dinero(kpi.valor)
      : kpi.formato === "porcentaje"
        ? `${kpi.valor.toFixed(1)} %`
        : compacto(kpi.valor);

  const d = kpi.delta;
  const bueno = d === null ? null : d === 0 ? null : d > 0 === kpi.subirEsBueno;
  const Flecha = d === null || d === 0 ? Minus : d > 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <Link
      href={kpi.href}
      className="group block rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
    >
      <p className="text-sm text-muted-foreground">{kpi.etiqueta}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight">{texto}</p>

      <div className="mt-3 flex items-end justify-between gap-3">
        <span
          className={[
            "inline-flex items-center gap-1 text-xs font-medium",
            bueno === null
              ? "text-muted-foreground"
              : bueno
                ? "text-success"
                : "text-destructive",
          ].join(" ")}
        >
          <Flecha className="size-3.5" />
          {d === null ? "sin mes anterior" : `${d > 0 ? "+" : ""}${d.toFixed(0)} % vs mes anterior`}
        </span>
        <div className="w-24 shrink-0">
          <Chispa serie={kpi.serie} etiqueta={kpi.etiqueta} />
        </div>
      </div>
    </Link>
  );
}
