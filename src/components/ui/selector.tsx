"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

/**
 * ELEGIR DE UNA LISTA, CON LA FORMA QUE PIDE EL LARGO DE LA LISTA.
 *
 * ── EL PROBLEMA ────────────────────────────────────────────────────────────
 *
 * Un `<select>` nativo con 54 contratos —o 635 tickets— es una lista que no se
 * puede leer. Y no es solo que sea larga: la búsqueda por tecleo del navegador
 * casa contra el PREFIJO de la opción, así que en una lista de folios que todos
 * empiezan por «CO» hay que teclear «CO1622…» de memoria para llegar. En la
 * práctica se scrollea a ciegas.
 *
 * Tampoco caben dos renglones: `<option>` solo admite texto plano, así que un
 * contrato no puede enseñar de quién es. Elegir entre veinte folios casi
 * idénticos sin el nombre del cliente al lado es adivinar.
 *
 * ── POR QUÉ NO SE REEMPLAZA SIEMPRE ────────────────────────────────────────
 *
 * Porque el `<select>` nativo es MEJOR cuando la lista es corta, y por razones
 * que un componente propio tiene que reconstruir a mano y casi nunca reconstruye
 * entero: lector de pantalla, navegación por teclado, la rueda del ratón, el
 * selector nativo del teléfono —que ocupa media pantalla y se maneja con el
 * pulgar—, y sobre todo que FUNCIONA SIN JAVASCRIPT. Cambiar los sesenta y
 * siete desplegables de la aplicación por un widget propio sería regalar todo
 * eso para arreglar los cinco que de verdad molestan.
 *
 * Por eso este componente decide: por debajo del umbral es un `<select>` de
 * verdad, y por encima es un combobox con búsqueda. La decisión la toma el
 * LARGO DE LA LISTA en tiempo de render, no quien escribe el formulario, para
 * que no haya que acordarse.
 *
 * ── EL UMBRAL: 12 ──────────────────────────────────────────────────────────
 *
 * No es una cifra redonda por gusto. El desplegable nativo enseña entre diez y
 * veinte renglones antes de tener que rodar, según navegador y alto de pantalla:
 * doce es el punto en el que dejar de ver la lista entera se vuelve lo normal en
 * vez de la excepción. Por debajo, escanear con los ojos gana a teclear; por
 * encima, teclear gana siempre.
 *
 * Se puede forzar con `umbral`. El caso que lo justifica es una lista corta pero
 * de opciones parecidas —donde el segundo renglón importa más que el largo—:
 * ahí `umbral={0}` da búsqueda desde el primer elemento.
 *
 * ── LO QUE HAY QUE CONSERVAR AL SALIRSE DE LO NATIVO ───────────────────────
 *
 * Se sigue el patrón `combobox` de WAI-ARIA, y las piezas no son decorativas:
 *
 *  · El foco NO se va a la lista. Se queda en el campo de texto y la opción
 *    activa se señala con `aria-activedescendant`, que es lo que permite seguir
 *    escribiendo para filtrar mientras se navega con las flechas.
 *  · `role="listbox"` y `role="option"` con `aria-selected`, para que un lector
 *    de pantalla anuncie «opción 3 de 12» y no «lista de enlaces».
 *  · Una región viva dice cuántos resultados quedan al filtrar. Sin ella, quien
 *    no ve la pantalla teclea sin saber si acertó o vació la lista.
 *  · Teclado completo: ↓ ↑ Inicio Fin Enter Esc. Esc con texto escrito limpia el
 *    filtro; Esc con el filtro limpio cierra. Son dos gestos distintos y
 *    colapsarlos obliga a cerrar y reabrir para corregir una letra.
 *  · Un `<input type="hidden">` lleva el valor. TODOS los formularios de este
 *    portal se envían con `FormData` a una acción de servidor: un combobox que
 *    solo guarda su estado en React manda el campo vacío y el error aparece en
 *    la acción, lejos de aquí.
 *
 * ── LA BÚSQUEDA IGNORA ACENTOS ─────────────────────────────────────────────
 *
 * «Mérida» tiene que salir escribiendo «merida». En un ERP mexicano la mitad de
 * lo que se teclea va sin acentos, y es el fallo más tonto y más frecuente de un
 * buscador en español —el mismo que ya corrige el clasificador de intención de
 * la capa de inteligencia—.
 */

export type Opcion = {
  value: string;
  /** El renglón principal. Lo que identifica la opción. */
  label: string;
  /**
   * El segundo renglón: de quién es, dónde está, cuánto vale.
   *
   * Es la mitad del valor de este componente. Un folio de contrato sin el
   * nombre del cliente al lado no distingue nada, y `<option>` no admite dos
   * renglones — por eso la lista larga no podía arreglarse con CSS.
   */
  detalle?: string | null;
  /** Texto extra por el que se puede encontrar y que no se enseña. */
  buscar?: string | null;
};

/** Minúsculas y sin acentos. Ver la nota de la cabecera. */
function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Cuántas opciones se PINTAN a la vez.
 *
 * El filtro puede no descartar nada —al abrir, o con el campo vacío— y hay
 * listas de seiscientos treinta y cinco tickets. Pintarlas todas son unos dos
 * mil nodos en el DOM para enseñar ocho: se paga en cada apertura, en un
 * elemento que se abre y se cierra muchas veces por pantalla.
 *
 * Cien es holgado para recorrer con la rueda y barato de pintar. Lo que se
 * recorta se DICE al pie —no se esconde—, porque una lista truncada en silencio
 * hace pensar que la opción que falta no existe, y quien la busca deja de
 * teclear justo cuando teclear era la solución.
 */
const TOPE_PINTADO = 100;

const CAMPO =
  "flex h-10 w-full rounded-lg border border-input bg-background px-3.5 text-sm shadow-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

export function Selector({
  name,
  opciones,
  placeholder = "Elige una opción…",
  defaultValue = "",
  required = false,
  disabled = false,
  umbral = 12,
  id,
  onChange,
  buscar,
  inicial = null,
}: {
  name: string;
  /** La lista. Con `buscar` se ignora: las opciones las trae la búsqueda. */
  opciones?: Opcion[];
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
  disabled?: boolean;
  /** Por encima de cuántas opciones se cambia a búsqueda. Ver la cabecera. */
  umbral?: number;
  id?: string;
  onChange?: (value: string) => void;
  /**
   * Búsqueda EN EL SERVIDOR, para listas que no caben en la página.
   *
   * El resto del componente supone que la lista entera llegó con el HTML, y
   * para los catálogos chicos es lo correcto. El de refacciones no lo es: son
   * miles, y mandarlas en cada visita pesaba más de un mega por pantalla. Con
   * `buscar`, lo tecleado se manda —con una pausa de 180 ms, no en cada letra—
   * y la lista es lo que vuelve. Siempre en modo combobox: un `<select>` no
   * puede preguntar.
   *
   * Tiene que ser una función ESTABLE (una acción de servidor, o envuelta en
   * `useCallback`): cambiarla vuelve a buscar.
   */
  buscar?: (q: string) => Promise<Opcion[]>;
  /**
   * Con `buscar`, la opción que corresponde a `defaultValue`. Sin ella el campo
   * sabría QUÉ valor tiene pero no qué decir: la lista aún no se ha pedido.
   */
  inicial?: Opcion | null;
}) {
  const auto = useId();
  const campoId = id ?? auto;
  const listaId = `${campoId}-lista`;

  const [valor, setValor] = useState(defaultValue);
  const [abierto, setAbierto] = useState(false);
  const [filtro, setFiltro] = useState("");
  const [activo, setActivo] = useState(0);

  const caja = useRef<HTMLDivElement>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLUListElement>(null);

  const remoto = !!buscar;
  const [remotas, setRemotas] = useState<Opcion[]>([]);
  // La última consulta RESPONDIDA: «buscando» se deduce de ella, sin un
  // `setState` al entrar al efecto.
  const [respondida, setRespondida] = useState<string | null>(null);
  // La elegida se guarda entera en modo remoto: la lista que la trajo cambia
  // con la siguiente búsqueda, y el campo tiene que seguir diciendo su nombre.
  const [elegidaRemota, setElegidaRemota] = useState<Opcion | null>(inicial);
  const lista = useMemo(
    () => (remoto ? remotas : (opciones ?? [])),
    [remoto, remotas, opciones],
  );

  const elegida = remoto
    ? valor && elegidaRemota?.value === valor
      ? elegidaRemota
      : null
    : (lista.find((o) => o.value === valor) ?? null);

  useEffect(() => {
    if (!buscar || !abierto) return;
    // `vigente`: si llega la respuesta de «lam» después de la de «lamp», se
    // descarta. Sin esto la lista enseña a veces lo que ya no está tecleado.
    let vigente = true;
    const q = filtro.trim();
    const t = setTimeout(
      () => {
        buscar(q)
          .then((r) => {
            if (!vigente) return;
            setRemotas(r);
            setActivo(0);
            setRespondida(q);
          })
          .catch(() => {
            if (!vigente) return;
            setRemotas([]);
            setRespondida(q);
          });
      },
      q ? 180 : 0,
    );
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [buscar, abierto, filtro]);
  const buscando = remoto && abierto && respondida !== filtro.trim();

  const visibles = useMemo(() => {
    // Lo remoto ya viene filtrado, y con el criterio del servidor.
    if (remoto) return lista;
    const q = normalizar(filtro.trim());
    if (!q) return lista;
    // Todas las palabras tienen que aparecer, en cualquier orden y en cualquiera
    // de los tres campos: así «waters monterrey» encuentra el contrato sin que
    // importe cómo esté escrito el renglón.
    const palabras = q.split(/\s+/);
    return lista.filter((o) => {
      const heno = normalizar(`${o.label} ${o.detalle ?? ""} ${o.buscar ?? ""}`);
      return palabras.every((p) => heno.includes(p));
    });
  }, [lista, filtro, remoto]);

  // Lo que de verdad va al DOM. El resto se cuenta y se anuncia.
  const pintadas = visibles.slice(0, TOPE_PINTADO);
  const ocultas = visibles.length - pintadas.length;

  /* Cerrar al pulsar fuera. Un desplegable que se queda abierto tapando la
     pantalla es peor que uno que no abre. */
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) cerrar();
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);

  /* La opción activa siempre a la vista: con el teclado se puede llegar a la
     número 40 de una lista que enseña ocho. */
  useEffect(() => {
    if (!abierto) return;
    listaRef.current
      ?.querySelector(`[data-i="${activo}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activo, abierto]);

  function abrir() {
    if (disabled) return;
    setAbierto(true);
    setFiltro("");
    // Arranca sobre lo ya elegido, no en el primero: reabrir para cambiar de
    // idea es el gesto más común y empezar desde arriba obliga a recorrer todo.
    setActivo(Math.max(0, lista.findIndex((o) => o.value === valor)));
  }

  function cerrar() {
    setAbierto(false);
    setFiltro("");
  }

  function elegir(o: Opcion) {
    setValor(o.value);
    setElegidaRemota(o);
    onChange?.(o.value);
    cerrar();
    entrada.current?.focus();
  }

  function limpiar() {
    setValor("");
    onChange?.("");
    setFiltro("");
    entrada.current?.focus();
  }

  function teclas(e: React.KeyboardEvent) {
    if (!abierto && (e.key === "ArrowDown" || e.key === "Enter")) {
      e.preventDefault();
      abrir();
      return;
    }
    if (!abierto) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActivo((i) => Math.min(i + 1, pintadas.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActivo((i) => Math.max(i - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActivo(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActivo(pintadas.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = pintadas[activo];
      if (o) elegir(o);
    } else if (e.key === "Escape") {
      e.preventDefault();
      // Dos gestos distintos: primero se limpia el filtro, después se cierra.
      if (filtro) setFiltro("");
      else cerrar();
    } else if (e.key === "Tab") {
      cerrar();
    }
  }

  /* ── Lista corta: el nativo, que es mejor ── */
  if (!remoto && lista.length <= umbral) {
    return (
      <select
        id={campoId}
        name={name}
        required={required}
        disabled={disabled}
        defaultValue={defaultValue}
        className={CAMPO}
        onChange={(e) => onChange?.(e.target.value)}
      >
        <option value="">{placeholder}</option>
        {lista.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
            {o.detalle ? ` · ${o.detalle}` : ""}
          </option>
        ))}
      </select>
    );
  }

  /* ── Lista larga: combobox con búsqueda ── */
  return (
    <div ref={caja} className="relative">
      {/* El valor que de verdad se envía. Ver la nota de la cabecera. */}
      <input type="hidden" name={name} value={valor} required={required} />

      <div className="relative">
        <input
          ref={entrada}
          id={campoId}
          type="text"
          role="combobox"
          aria-expanded={abierto}
          aria-controls={listaId}
          aria-autocomplete="list"
          aria-activedescendant={
            abierto && pintadas[activo] ? `${listaId}-${activo}` : undefined
          }
          autoComplete="off"
          disabled={disabled}
          className={`${CAMPO} pr-16 ${elegida && !abierto ? "" : "text-foreground"}`}
          placeholder={placeholder}
          value={abierto ? filtro : (elegida?.label ?? "")}
          onChange={(e) => {
            if (!abierto) setAbierto(true);
            setFiltro(e.target.value);
            setActivo(0);
          }}
          onFocus={() => !abierto && abrir()}
          onKeyDown={teclas}
        />

        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
          {elegida && !disabled ? (
            <button
              type="button"
              onClick={limpiar}
              aria-label="Quitar la selección"
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
          <span className="pointer-events-none p-1 text-muted-foreground">
            {abierto ? <Search className="size-4" /> : <ChevronDown className="size-4" />}
          </span>
        </div>
      </div>

      {/* Cuántos resultados quedan, para quien no ve la lista. */}
      <span aria-live="polite" className="sr-only">
        {abierto && buscando
          ? "Buscando…"
          : abierto
          ? `${visibles.length} ${visibles.length === 1 ? "resultado" : "resultados"}` +
          (ocultas > 0 ? `, se muestran los primeros ${pintadas.length}` : "")
          : ""}
      </span>

      {abierto ? (
        <ul
          ref={listaRef}
          id={listaId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          {visibles.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              {buscando
                ? "Buscando…"
                : filtro
                  ? `Nada coincide con «${filtro}».`
                  : "No hay opciones."}
            </li>
          ) : (
            pintadas.map((o, i) => {
              const seleccionada = o.value === valor;
              return (
                <li
                  key={o.value}
                  id={`${listaId}-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={seleccionada}
                  // `mousedown` y no `click`: el clic llega después del blur del
                  // campo, y para entonces la lista ya se cerró y no hay nada
                  // que pulsar.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    elegir(o);
                  }}
                  onMouseEnter={() => setActivo(i)}
                  className={`flex cursor-pointer items-start gap-2 rounded-md px-2.5 py-2 text-sm ${
                    i === activo ? "bg-muted" : ""
                  }`}
                >
                  <Check
                    className={`mt-0.5 size-3.5 shrink-0 ${
                      seleccionada ? "text-primary" : "invisible"
                    }`}
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{o.label}</span>
                    {o.detalle ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {o.detalle}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })
          )}
          {ocultas > 0 ? (
            <li
              // `presentation`: es un pie, no una opción. Con `role="option"`
              // las flechas se pararían encima de algo que no se puede elegir.
              role="presentation"
              className="border-t border-border px-2.5 py-2 text-center text-xs text-muted-foreground"
            >
              y {ocultas} más — sigue escribiendo para acotar
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
