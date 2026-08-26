import type { PlatformCopy } from "@/components/astraion/copy";

/**
 * El producto, enseñado.
 *
 * ── QUÉ PROBLEMA RESUELVE ──────────────────────────────────────────────────
 *
 * La página argumentaba muy bien qué ES Astraion —tres capas, un pronóstico,
 * una lista de módulos— y no enseñaba una sola pantalla. Quien no sabe qué es
 * un ERP terminaba la página sin haber visto el sistema que se le ofrece, y
 * quien sí lo sabe no tenía cómo juzgar si está terminado o es una promesa.
 *
 * Dos figuras, y la segunda no es decoración: la ventana es la capa 1 —la
 * operación entera en una pantalla— y el tablero es la capa 3 leyendo esa
 * misma operación. Puestas juntas, la tesis del titular deja de ser una
 * afirmación y pasa a ser algo que se ve.
 *
 * ── POR QUÉ NO ES UNA CAPTURA DE PANTALLA ─────────────────────────────────
 *
 * La razón que más pesa es que la base local ES producción: una captura real
 * traería razones sociales, RFC e importes de contrato de clientes reales a
 * una página pública. Aquí se decide exactamente qué se enseña.
 *
 * Y aparte: un PNG queda clavado en un ancho y en un idioma, se ve borroso en
 * pantallas densas, y envejece el día que cambia el producto sin que nadie se
 * entere. Esto se reajusta, se traduce con el resto de la página y no puede
 * quedar desactualizado en silencio, porque es la misma maqueta.
 *
 * ── LAS CIFRAS ────────────────────────────────────────────────────────────
 *
 * Las de Servicio y Clientes son las de Evoelution, el primer cliente, y son
 * las mismas que la página ya publica en la línea de prueba. Las de Ventas,
 * Inventario y Compras son de ejemplo: esos módulos existen y están vacíos en
 * esa empresa, y enseñar cinco ceros diría del producto algo que no es cierto.
 * El pie lo dice: es un ejemplo, no un informe.
 *
 * Sin datos de personas: los técnicos van por nombre de pila, sin apellido, y
 * los asuntos son descripciones técnicas sin cliente detrás.
 */

type Shot = PlatformCopy["product"]["shot"];

/**
 * Área del panel: un nombre y dos o tres cifras. Igual que en el producto.
 *
 * Las llaves se tipan contra la copia y no como `string`: es lo que hace que
 * añadir un área aquí y olvidar su etiqueta —o al revés, y en cualquiera de
 * los dos idiomas— no compile, en vez de salir a producción como un hueco.
 */
type Area = {
  key: keyof Shot["areas"];
  figures: Array<{ key: keyof Shot["figures"]; value: string; alert?: boolean }>;
  /** Las dos de la segunda fila, que se reparten el ancho. Ver `.shotAreaWide`. */
  wide?: boolean;
};

const AREAS: Area[] = [
  {
    key: "servicio",
    figures: [
      { key: "tickets", value: "633" },
      { key: "abiertos", value: "124" },
      // Lo único cálido de la ventana. Ver la nota de `.shotAlert`.
      { key: "sinAsignar", value: "2", alert: true },
    ],
  },
  {
    key: "ventas",
    figures: [
      { key: "abiertos", value: "14" },
      { key: "enJuego", value: "$1.4M" },
      { key: "ganados", value: "31" },
    ],
  },
  {
    key: "clientes",
    figures: [
      { key: "clientes", value: "161" },
      { key: "contratos", value: "19" },
      { key: "porVencer", value: "3", alert: true },
    ],
  },
  {
    key: "inventario",
    wide: true,
    figures: [
      { key: "refacciones", value: "412" },
      { key: "sinExistencia", value: "7", alert: true },
    ],
  },
  {
    key: "compras",
    wide: true,
    figures: [
      { key: "ordenes", value: "9" },
      { key: "porPagar", value: "$318k" },
    ],
  },
];

/** Folios y estados. El texto del asunto viaja en la copia: se traduce. */
const ROWS = [
  { ref: "EVO-000699", tone: "open" as const },
  { ref: "EVO-000698", tone: "wait" as const },
  { ref: "EVO-000696", tone: "done" as const },
  { ref: "EVO-000695", tone: "done" as const },
];

/**
 * Reparto de carga entre el equipo. Son las proporciones reales del primer
 * cliente —Rubén 239, Aranza 204, Luis 130, Oscar 37— sin apellidos.
 *
 * El ancho sale del máximo y no de la suma: una barra tiene que poder llegar
 * al final, o la más alta parece la mitad de lo que es.
 */
const LOAD = [
  { name: "Rubén", value: 239 },
  { name: "Aranza", value: 204 },
  { name: "Luis", value: 130 },
  { name: "Oscar", value: 37 },
];
const LOAD_MAX = Math.max(...LOAD.map((l) => l.value));

const BADGE = { open: "badgeOpen", wait: "badgeWait", done: "badgeDone" } as const;

export function PanelPreview({
  styles: s,
  copy: t,
}: {
  styles: Record<string, string>;
  copy: PlatformCopy["product"];
}) {
  return (
    <div className={s.product}>
      {/* ---------------- La ventana: la empresa al entrar ---------------- */}
      <figure className={s.shot}>
        {/*
          Todo el interior queda fuera del árbol de accesibilidad y el pie carga
          con el significado. Es una lámina del producto: leerla renglón por
          renglón —«barra lateral, Panel, Servicio, Ventas…»— sería ruido, y
          quien la escucha no puede pulsar nada de lo que oye.
        */}
        <div className={s.shotFrame} aria-hidden="true">
          <div className={s.shotBar}>
            <span className={s.shotDots}>
              <i />
              <i />
              <i />
            </span>
            <span className={s.shotUrl}>{t.shot.url}</span>
          </div>

          <div className={s.shotBody}>
            <aside className={s.shotNav}>
              <div className={s.shotBrand}>
                <span className={s.shotBrandMark}>E</span>
                <span className={s.shotBrandName}>{t.shot.brand}</span>
              </div>
              <ul className={s.shotNavList}>
                {t.shot.nav.map((item, i) => (
                  <li
                    key={item}
                    className={`${s.shotNavItem} ${i === 0 ? s.shotNavOn : ""}`}
                  >
                    {item}
                  </li>
                ))}
              </ul>
              <p className={s.shotPowered}>{t.shot.powered}</p>
            </aside>

            <div className={s.shotMain}>
              <p className={s.shotHi}>{t.shot.hi}</p>
              <p className={s.shotSub}>{t.shot.sub}</p>

              <div className={s.shotAreas}>
                {AREAS.map((a) => (
                  <article
                    key={a.key}
                    className={`${s.shotArea} ${a.wide ? s.shotAreaWide : ""}`}
                  >
                    <h4 className={s.shotAreaName}>{t.shot.areas[a.key]}</h4>
                    <dl className={s.shotFigs}>
                      {a.figures.map((f) => (
                        <div key={f.key} className={s.shotFig}>
                          <dt className={s.shotFigLabel}>{t.shot.figures[f.key]}</dt>
                          <dd
                            className={`${s.shotFigVal} ${f.alert ? s.shotAlert : ""}`}
                          >
                            {f.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </article>
                ))}
              </div>

              <div className={s.shotList}>
                <div className={s.shotListHead}>
                  <span>{t.shot.listTitle}</span>
                  <span className={s.shotListMore}>{t.shot.listMore}</span>
                </div>
                {ROWS.map((r, i) => (
                  <div key={r.ref} className={s.shotRow}>
                    <span className={s.shotRef}>{r.ref}</span>
                    <span className={s.shotSubject}>{t.shot.subjects[i]}</span>
                    <span className={`${s.shotBadge} ${s[BADGE[r.tone]]}`}>
                      {t.shot.states[r.tone]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <figcaption className={s.shotCap}>{t.shot.caption}</figcaption>
      </figure>

      {/* ---------------- El tablero: la capa 3 leyendo lo de arriba ---------------- */}
      <figure className={s.board}>
        <div aria-hidden="true">
          <div className={s.boardHead}>
            <h3 className={s.boardTitle}>{t.board.title}</h3>
            <span className={s.boardTag}>{t.board.tag}</span>
          </div>
          <p className={s.boardNote}>{t.board.note}</p>

          <div className={s.boardBars}>
            {LOAD.map((l) => (
              <div key={l.name} className={s.boardBar}>
                <span className={s.boardBarLabel}>{l.name}</span>
                <span className={s.boardBarTrack}>
                  <span
                    className={s.boardBarFill}
                    style={{ width: `${Math.round((l.value / LOAD_MAX) * 100)}%` }}
                  />
                </span>
                <span className={s.boardBarVal}>{l.value}</span>
              </div>
            ))}
          </div>
        </div>

        <figcaption className={s.boardFoot}>{t.board.foot}</figcaption>
      </figure>
    </div>
  );
}
