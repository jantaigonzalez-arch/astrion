"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Loader2, MapPin, Plane, Plus, X } from "lucide-react";
import { crearViaticoAction, type ViaticoState } from "@/lib/actions/viaticos";
import { Link } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Selector } from "@/components/ui/selector";
import { createOrganization } from "@/lib/actions/crm";
import { ROLE_LABELS } from "@/lib/roles";
import { DESTINO_AYUDA, DESTINO_LABELS, type TipoDestinoViatico } from "@/lib/viaticos";

const initial: ViaticoState = { ok: false };

/**
 * El rol, en el segundo renglón del selector de aprobador.
 *
 * `ROLE_LABELS` es el mismo mapa que usan la pantalla de usuarios y la de
 * permisos: escribir aquí «General» a mano habría dejado dos vocabularios para
 * la misma cosa, y quien configura tiene que reconocer en un sitio lo que leyó
 * en el otro. El `Record<string, …>` es porque aquí el rol llega como cadena
 * —viene de la consulta— y no como la unión de `MembershipRole`.
 */
const ROL_LABEL: Record<string, string> = ROLE_LABELS;

/** El domicilio en las tres piezas que arma `data/viaticos.ts`. */
export type Domicilio = {
  /** «Municipio, Estado». Null si no están los dos capturados. */
  sugerencia: string | null;
  /** La dirección legible, para saber a dónde se va. */
  completo: string | null;
  /** El domicilio sin desarmar, cuando es lo único que hay. */
  crudo: string | null;
  /** Entre qué calles, seña para llegar. */
  seña: string | null;
};

/** Una empresa a la que se puede viajar: un cliente sin contrato o un prospecto. */
export type EmpresaOpcion = {
  id: string;
  name: string;
  domicilio: Domicilio;
  /** Sus oportunidades abiertas, ya cargadas. Puede ir vacío. */
  negocios: Array<{ id: string; reference: string; title: string }>;
};
/** Se conserva el nombre de antes de la 0037, cuando solo había prospectos. */
export type ProspectoOpcion = EmpresaOpcion;

export type ContratoOpcion = {
  id: string;
  number: string;
  cliente: string | null;
  /** El domicilio del cliente, en tres piezas. Ver `data/viaticos.ts`. */
  domicilio: Domicilio;
  modulos: Array<{
    id: string;
    name: string;
    brand: string;
    serialNumber: string | null;
    equipmentName: string;
  }>;
};

/** Un destino ya elegido, tal como viaja a la acción en `destinos` (JSON). */
type Elegido =
  | { tipo: "contrato"; contractId: string }
  | { tipo: "visita" | "prospecto"; organizationId: string; dealId: string | null };

const esComercial = (t: TipoDestinoViatico) => t !== "contrato";

/**
 * Pedir viáticos.
 *
 * ── A DÓNDE SE VIAJA MANDA SOBRE TODO LO DEMÁS ─────────────────────────────
 *
 * Un viaje va a CONTRATOS —atender lo que ya se vendió—, a VISITAS —clientes
 * que ya compraron y no tienen contrato vigente— o a PROSPECTOS —quien todavía
 * no compra—, y de esa elección cuelga el resto del formulario: los módulos
 * solo existen del lado del contrato, el negocio solo del lado de la empresa.
 *
 * Se pinta como pestañas y no como un desplegable porque no es un dato más: es
 * la pregunta que cambia el formulario, y esconderla dentro de un `<select>`
 * hace que la mitad de los campos aparezca y desaparezca sin que se vea por qué.
 *
 * ── LO QUE SE OFRECE LO DECIDE LA EMPRESA ──────────────────────────────────
 *
 * Todo lo que cambia esta pantalla es configuración (Configuración → Viáticos,
 * y ver `.claude/skills/decisiones-configurables`):
 *
 *   · `tipos`: solo las pestañas que el rol de quien mira puede pedir. Con una
 *     sola, no hay pestañas: ni una pestaña sola ni una opción deshabilitada
 *     que invite a preguntar por qué no se puede.
 *   · `maxPorTipo`: cuántos contratos, clientes y prospectos caben en un
 *     viático. Si en total no cabe más de uno, el formulario es el de siempre;
 *     si caben más, aparece la GIRA —la lista de destinos del viaje— y se
 *     agregan uno a uno, y cada pestaña desaparece cuando su tipo se llena.
 *   · `mezclar`: si está apagado, en cuanto la gira tiene un contrato solo se
 *     ofrecen contratos, y al revés. El viaje de servicio y el comercial se
 *     piden por separado.
 *
 * Esto solo PINTA la regla: la que decide es `vetoDestinos` en
 * `domain/viaticos.ts`, que la vuelve a comprobar al guardar. Si la pantalla no
 * preguntara, enseñaría opciones que revientan al enviar; si el dominio se
 * fiara de la pantalla, bastaría un `curl` para saltársela.
 *
 * ── LO QUE ESTÁ ELEGIDO EN EL EDITOR TAMBIÉN CUENTA ────────────────────────
 *
 * Con varios destinos, el contrato o la empresa que está elegida y todavía no
 * se agregó a la gira se envía igual. Obligar a pulsar «agregar» antes de
 * guardar un viaje de un solo destino sería un paso que no pide nadie, y el
 * error que produce —«elige al menos un destino» con uno elegido en pantalla—
 * no se entiende.
 *
 * ── LO CARGADO POR ADELANTADO ──────────────────────────────────────────────
 *
 * Módulos y negocios viajan YA CARGADOS con cada contrato y cada empresa en vez
 * de pedirse al cambiar el desplegable: son unos cientos en total, caben de
 * sobra en la respuesta, y así el segundo campo se llena sin esperar a la red.
 */
export function NuevoViaticoForm({
  contratos,
  visitas,
  prospectos,
  aprobadores,
  tipos,
  maxPorTipo,
  mezclar,
  puedeCrearProspectos,
}: {
  contratos: ContratoOpcion[];
  /** Clientes sin contrato vigente. Vacío si el rol no puede visitarlos. */
  visitas: EmpresaOpcion[];
  prospectos: EmpresaOpcion[];
  aprobadores: Array<{ id: string; name: string | null; role: string }>;
  /** Qué tipos de destino puede pedir quien mira, según su empresa. Al menos uno. */
  tipos: TipoDestinoViatico[];
  /** Cuántos destinos de cada tipo caben en una solicitud. */
  maxPorTipo: Record<TipoDestinoViatico, number>;
  /** Si una solicitud junta contratos con visitas o prospectos. */
  mezclar: boolean;
  /** Además puede dar de alta un prospecto sin salir de aquí (`ventas: editar`). */
  puedeCrearProspectos: boolean;
}) {
  const [state, action, pending] = useActionState(crearViaticoAction, initial);
  const [tipo, setTipo] = useState<TipoDestinoViatico>(tipos[0]);
  const [contractId, setContractId] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [dealId, setDealId] = useState("");
  const [gira, setGira] = useState<Elegido[]>([]);
  const [destino, setDestino] = useState("");
  /*
    Los prospectos dados de alta aquí mismo, sin recargar.

    Se guardan en estado en vez de recargar la página porque la alternativa es
    perder lo que ya se escribió —fechas, motivo, monto— por haber caído en la
    cuenta a media captura de que la empresa no estaba dada de alta. Ese es el
    momento en que ocurre de verdad.
  */
  const [reciennacidos, setReciennacidos] = useState<EmpresaOpcion[]>([]);

  /*
    ¿CABE MÁS DE UN DESTINO? Con lo que su rol puede pedir y los topes de su
    empresa. Sin mezclar, un viaje es de servicio o comercial, así que cuenta el
    mayor de los dos lados, no la suma.
  */
  const topeDe = (t: TipoDestinoViatico) => (tipos.includes(t) ? maxPorTipo[t] : 0);
  const comercialTotal = topeDe("visita") + topeDe("prospecto");
  const unico =
    (mezclar ? topeDe("contrato") + comercialTotal : Math.max(topeDe("contrato"), comercialTotal)) <= 1;
  const todosLosProspectos = [...reciennacidos, ...prospectos];
  const empresasDe = (t: TipoDestinoViatico) => (t === "visita" ? visitas : todosLosProspectos);

  /*
    QUÉ TIPOS TODAVÍA CABEN en una lista de destinos: los que no llegaron a su
    tope y, sin mezclar, los del mismo lado que lo ya elegido —con un contrato,
    solo contratos; con una visita o un prospecto, solo lo comercial—.
  */
  const conCupo = (lista: Elegido[]) =>
    tipos.filter((t) => {
      if (lista.filter((d) => d.tipo === t).length >= maxPorTipo[t]) return false;
      if (!mezclar && lista.some((d) => d.tipo === "contrato") && esComercial(t)) return false;
      if (!mezclar && lista.some((d) => esComercial(d.tipo)) && t === "contrato") return false;
      return true;
    });
  const hayContrato = gira.some((d) => d.tipo === "contrato");
  const hayComercial = gira.some((d) => esComercial(d.tipo));
  const tiposVisibles = unico ? tipos : conCupo(gira);
  const tipoActual = tiposVisibles.includes(tipo) ? tipo : (tiposVisibles[0] ?? tipos[0]);

  const contrato = tipoActual === "contrato" ? contratos.find((c) => c.id === contractId) : undefined;
  const empresa =
    tipoActual !== "contrato" ? empresasDe(tipoActual).find((o) => o.id === organizationId) : undefined;

  const borrador: Elegido | null =
    tipoActual === "contrato"
      ? contrato
        ? { tipo: "contrato", contractId: contrato.id }
        : null
      : empresa
        ? { tipo: tipoActual, organizationId: empresa.id, dealId: dealId || null }
        : null;

  const yaEsta = (e: Elegido) =>
    gira.some((d) =>
      d.tipo === "contrato" && e.tipo === "contrato"
        ? d.contractId === e.contractId
        : d.tipo !== "contrato" && e.tipo !== "contrato" && d.organizationId === e.organizationId,
    );
  const lleno = !unico && tiposVisibles.length === 0;
  /** ¿Quedaría sitio para otro destino si se agrega el que está elegido? */
  const cabeOtroTrasAgregar = (e: Elegido) => conCupo([...gira, e]).length > 0;
  /** «Hasta 3 prospectos y 1 contrato»: los topes de lo que este rol puede pedir. */
  const topesEnPalabras = tipos
    .map((t) =>
      t === "contrato"
        ? `${maxPorTipo[t]} ${maxPorTipo[t] === 1 ? "contrato" : "contratos"}`
        : t === "visita"
          ? `${maxPorTipo[t]} ${maxPorTipo[t] === 1 ? "cliente a visitar" : "clientes a visitar"}`
          : `${maxPorTipo[t]} ${maxPorTipo[t] === 1 ? "prospecto" : "prospectos"}`,
    )
    .join(", ");

  /** Lo que se envía: la gira, más lo elegido en el editor si aún no se agregó. */
  const destinos: Elegido[] = unico
    ? borrador
      ? [borrador]
      : []
    : [...gira, ...(borrador && !yaEsta(borrador) && !lleno ? [borrador] : [])];

  /*
    Los MÓDULOS, de todos los contratos del viaje. Con un solo contrato, sin
    encabezado —es el formulario de siempre—; con varios, agrupados por
    contrato, porque un módulo se reconoce por el equipo y el equipo por el
    contrato.
  */
  const contratosDelViaje = destinos
    .filter((d): d is Extract<Elegido, { tipo: "contrato" }> => d.tipo === "contrato")
    .map((d) => contratos.find((c) => c.id === d.contractId))
    .filter((c): c is ContratoOpcion => Boolean(c));

  /*
    El domicilio y el nombre salen de lo que está elegido en el editor, sea
    contrato o empresa. Una sola copia de esa lógica —que ya tiene tres casos—,
    en vez de una por tipo que se quede sin arreglar cuando alguien corrija la
    otra.
  */
  const dom = contrato?.domicilio ?? empresa?.domicilio;
  const aQuien = contrato ? (contrato.cliente ?? "El cliente") : empresa?.name;

  /**
   * Elegir a dónde se viaja propone el destino, y NO pisa lo que ya se escribió.
   *
   * El destino de un viático es casi siempre donde está la empresa, así que
   * teclearlo a mano es copiar un dato que el sistema ya tiene — y cada copia a
   * mano es una ciudad mal escrita que después no agrupa en ningún informe.
   *
   * Solo se rellena si el campo está VACÍO o si lo que hay es la sugerencia
   * anterior. Quien viaja a un sitio distinto al domicilio —una planta, otra
   * sucursal— lo escribe, y cambiar de contrato no se lo borra. En una gira, lo
   * propone el PRIMER destino: es por donde empieza el viaje.
   */
  function proponerDestino(previa: string | null | undefined, nueva: string | null) {
    if (!unico && gira.length > 0) return;
    setDestino((actual) =>
      actual.trim() === "" || actual === previa ? (nueva ?? "") : actual,
    );
  }

  function elegirContrato(id: string) {
    proponerDestino(
      contrato?.domicilio.sugerencia,
      contratos.find((c) => c.id === id)?.domicilio.sugerencia ?? null,
    );
    setContractId(id);
  }

  /**
   * `recien` para el que acaba de nacer, y no es rebuscamiento.
   *
   * Cuando esto se llama desde el alta rápida, el prospecto nuevo todavía NO
   * está en `todosLosProspectos`: `setReciennacidos` no ha vuelto a pintar.
   * Buscarlo en la lista devolvía `undefined` y el destino se quedaba vacío
   * justo en el caso en que más ayuda.
   */
  function elegirEmpresa(id: string, recien?: EmpresaOpcion) {
    proponerDestino(
      empresa?.domicilio.sugerencia,
      (recien ?? empresasDe(tipoActual).find((p) => p.id === id))?.domicilio.sugerencia ?? null,
    );
    setOrganizationId(id);
    setDealId("");
  }

  /** Cambiar de pestaña limpia la elección de la otra, no la conserva escondida. */
  function cambiarTipo(nuevo: TipoDestinoViatico) {
    if (nuevo === tipoActual) return;
    setTipo(nuevo);
    setContractId("");
    setOrganizationId("");
    setDealId("");
  }

  /** Pasa lo elegido a la gira y deja el editor limpio para el siguiente. */
  function agregar() {
    if (!borrador || yaEsta(borrador) || lleno || !cabeOtroTrasAgregar(borrador)) return;
    if (gira.length === 0 && dom?.sugerencia) {
      setDestino((actual) => (actual.trim() === "" ? dom.sugerencia! : actual));
    }
    setGira((g) => [...g, borrador]);
    setContractId("");
    setOrganizationId("");
    setDealId("");
  }

  function nombreDe(e: Elegido): { titulo: string; detalle: string | null } {
    if (e.tipo === "contrato") {
      const c = contratos.find((x) => x.id === e.contractId);
      return { titulo: c?.number ?? "—", detalle: c?.cliente ?? null };
    }
    const o = empresasDe(e.tipo).find((x) => x.id === e.organizationId);
    const n = o?.negocios.find((x) => x.id === e.dealId);
    return { titulo: o?.name ?? "—", detalle: n ? `Negocio: ${n.title}` : null };
  }

  if (state.ok && state.viaticoId) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <CheckCircle2 className="size-12 text-success" />
        <div>
          <p className="font-medium">Viático creado</p>
          {/*
            Se crea en BORRADOR y no enviado, a propósito: el envío es el acto
            que lo pone delante de quien autoriza y conviene que sea un gesto
            aparte, no el efecto secundario de guardar. Quien pide puede releer
            lo que escribió antes de que lo lea nadie más.
          */}
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Quedó como borrador. Revísalo y mándalo cuando esté listo: hasta
            entonces no lo ve quien autoriza.
          </p>
        </div>
        <Button asChild variant="accent">
          <Link href={`/admin/viaticos/${state.viaticoId}`}>Abrir el viático</Link>
        </Button>
      </div>
    );
  }

  const listaEmpresas = tipoActual === "contrato" ? [] : empresasDe(tipoActual);
  // En una gira no se ofrece dos veces lo que ya está en ella.
  const disponibles = <T extends { id: string }>(xs: T[], clave: "contrato" | "empresa") =>
    unico
      ? xs
      : xs.filter((x) =>
          !gira.some((d) =>
            clave === "contrato"
              ? d.tipo === "contrato" && d.contractId === x.id
              : d.tipo !== "contrato" && d.organizationId === x.id,
          ),
        );

  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="destinos" value={JSON.stringify(destinos)} />

      {!unico ? (
        <div>
          <Label>Destinos del viaje</Label>
          {gira.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Hasta {topesEnPalabras} por viaje. Elige el primero abajo; para una
              gira, agrégalo y elige el siguiente.
            </p>
          ) : (
            <ol className="mt-1 space-y-1.5">
              {gira.map((d, i) => {
                const n = nombreDe(d);
                return (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-xs">
                        {DESTINO_LABELS[d.tipo]}
                      </span>
                      <span className={d.tipo === "contrato" ? "font-mono" : "font-medium"}>
                        {n.titulo}
                      </span>
                      {n.detalle ? (
                        <span className="text-muted-foreground"> · {n.detalle}</span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      onClick={() => setGira((g) => g.filter((_, j) => j !== i))}
                      aria-label="Quitar este destino"
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <X className="size-4" />
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {!mezclar && (hayContrato || hayComercial) && tipos.length > 1 ? (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Tu empresa pide por separado los viajes de servicio y los
              comerciales: {hayContrato ? "este viaje ya es a contratos." : "este viaje ya es comercial."}
            </p>
          ) : null}
        </div>
      ) : null}

      {lleno ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
          Ya no caben más destinos en este viaje: tu empresa permite hasta{" "}
          {topesEnPalabras}.
        </p>
      ) : (
        <div className={unico ? "grid gap-5" : "grid gap-4 rounded-lg border border-border p-4"}>
          {tiposVisibles.length > 1 ? (
            <div>
              <Label>{unico || gira.length === 0 ? "¿A quién se viaja?" : "Siguiente destino"}</Label>
              <div
                className={`mt-1 grid gap-2 ${tiposVisibles.length === 3 ? "sm:grid-cols-3" : "grid-cols-2"}`}
              >
                {tiposVisibles.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => cambiarTipo(t)}
                    aria-pressed={tipoActual === t}
                    className={`rounded-lg border px-3 py-2.5 text-left transition ${
                      tipoActual === t ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
                    }`}
                  >
                    <span className="block text-sm font-medium">
                      {t === "contrato" ? "Cliente con contrato" : t === "visita" ? "Visita a cliente" : "Prospecto"}
                    </span>
                    <span className="block text-xs text-muted-foreground">{DESTINO_AYUDA[t]}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {tipoActual === "contrato" ? (
            <div>
              <Label htmlFor="contractId">Contrato de servicio</Label>
              {/*
                Con búsqueda: los folios de contrato empiezan todos por las mismas
                letras, así que el tecleo del navegador —que casa contra el
                prefijo— no llega a ninguno. El cliente va en el segundo renglón
                porque es lo único que distingue un folio de otro a ojo.

                La `key` cuenta la gira: al agregar un destino, el selector se
                vacía para elegir el siguiente.
              */}
              <Selector
                key={`contratos-${gira.length}`}
                id="contractId"
                name="_contrato"
                required={unico}
                placeholder="Elige un contrato…"
                opciones={disponibles(contratos, "contrato").map((c) => ({
                  value: c.id,
                  label: c.number,
                  detalle: c.cliente,
                  // Se encuentra también por el destino, que es como se piensa un
                  // viaje: «voy a Mérida» antes que «voy al contrato CO16…».
                  buscar: c.domicilio.sugerencia ?? c.domicilio.completo,
                }))}
                onChange={elegirContrato}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                El gasto de este destino se le carga a la utilidad de este contrato.
              </p>
            </div>
          ) : (
            <div className="grid gap-5">
              <div>
                <Label htmlFor="organizationId">
                  {tipoActual === "visita" ? "Cliente que se visita" : "Prospecto"}
                </Label>
                {/*
                  LA `key` FUERZA EL REMONTAJE CUANDO NACE UNO NUEVO O SE AGREGA
                  UNO A LA GIRA.

                  `Selector` guarda su propio valor por dentro y solo lee
                  `defaultValue` al montarse, así que elegir desde fuera —que es
                  lo que hace el alta rápida— no movía lo que se ve.
                */}
                <Selector
                  key={`${tipoActual}-${reciennacidos.length}-${gira.length}`}
                  id="organizationId"
                  name="_empresa"
                  required={unico}
                  defaultValue={organizationId}
                  placeholder={tipoActual === "visita" ? "Elige al cliente…" : "Elige un prospecto…"}
                  opciones={disponibles(listaEmpresas, "empresa").map((p) => ({
                    value: p.id,
                    label: p.name,
                    detalle: p.domicilio.sugerencia,
                    buscar: p.domicilio.completo,
                  }))}
                  onChange={(id) => elegirEmpresa(id)}
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {tipoActual === "visita"
                    ? "Clientes que ya compraron y no tienen contrato vigente. Al que sí lo tiene se le viaja por su contrato."
                    : "Empresas sin ninguna compra registrada. En cuanto compren, pasan a Clientes con su historial."}
                </p>
                {tipoActual === "prospecto" && puedeCrearProspectos ? (
                  <AltaProspectoRapida
                    onCreado={(nuevo) => {
                      setReciennacidos((previos) => [nuevo, ...previos]);
                      elegirEmpresa(nuevo.id, nuevo);
                    }}
                  />
                ) : null}
              </div>

              {empresa ? (
                <div>
                  <Label htmlFor="dealId">Negocio (opcional)</Label>
                  {empresa.negocios.length === 0 ? (
                    <p className="mt-1 rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                      No tiene oportunidades abiertas. El viaje se registra igual:
                      el gasto queda como costo comercial de esta empresa.
                    </p>
                  ) : (
                    <Selector
                      key={empresa.id}
                      id="dealId"
                      name="_negocio"
                      placeholder="Sin negocio concreto"
                      opciones={empresa.negocios.map((n) => ({
                        value: n.id,
                        label: n.title,
                        detalle: n.reference,
                      }))}
                      onChange={setDealId}
                    />
                  )}
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Si el viaje es por una oportunidad concreta, dilo aquí y el
                    costo se podrá leer en su ficha. Si no, déjalo en blanco.
                  </p>
                </div>
              ) : null}
            </div>
          )}

          {/*
            EL DOMICILIO DEL CLIENTE, CON SUS TRES CASOS DICHOS.

            Unos tienen municipio y estado capturados, otros solo el domicilio en
            texto libre sin desarmar, y otros nada. Los tres se enseñan distinto
            a propósito: callar los dos últimos convertiría «no hay dato» en «el
            sistema no funciona».
          */}
          {borrador ? (
            <div className="rounded-lg bg-muted/60 px-3 py-2 text-xs">
              {dom?.completo ? (
                <p className="flex items-start gap-1.5 text-muted-foreground">
                  <MapPin className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    <span className="font-medium text-foreground">{aQuien}</span> ·{" "}
                    {dom.completo}
                    {dom.seña ? <span className="block text-muted-foreground">{dom.seña}</span> : null}
                  </span>
                </p>
              ) : dom?.crudo ? (
                <p className="flex items-start gap-1.5 text-muted-foreground">
                  <MapPin className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {dom.crudo}
                    <span className="block">Domicilio sin desarmar: escribe el destino a mano.</span>
                  </span>
                </p>
              ) : (
                <p className="text-muted-foreground">
                  No tiene domicilio capturado. Escribe el destino a mano.
                </p>
              )}
              {dom?.sugerencia && destino !== dom.sugerencia && (unico || gira.length === 0) ? (
                <button
                  type="button"
                  onClick={() => setDestino(dom.sugerencia!)}
                  className="mt-1.5 text-primary hover:underline"
                >
                  Usar «{dom.sugerencia}»
                </button>
              ) : null}
            </div>
          ) : null}

          {!unico ? (
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={agregar}
                disabled={!borrador || yaEsta(borrador) || !cabeOtroTrasAgregar(borrador)}
                title={
                  borrador && !cabeOtroTrasAgregar(borrador)
                    ? "Este es el último destino que cabe: se enviará con el viaje."
                    : undefined
                }
              >
                <Plus className="size-4" /> Agregar y elegir otro destino
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {contratosDelViaje.length > 0 ? (
        <div>
          <Label>Módulos que vas a atender</Label>
          <div className="mt-1 max-h-64 space-y-2 overflow-y-auto rounded-lg border border-border p-2">
            {contratosDelViaje.map((c) => (
              <div key={c.id}>
                {contratosDelViaje.length > 1 ? (
                  <p className="px-2 pt-1 font-mono text-xs text-muted-foreground">{c.number}</p>
                ) : null}
                {c.modulos.length === 0 ? (
                  <p className="px-2 py-1.5 text-sm text-muted-foreground">
                    Este contrato no tiene módulos capturados.
                  </p>
                ) : (
                  c.modulos.map((m) => (
                    <label
                      key={m.id}
                      className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                    >
                      <input
                        type="checkbox"
                        name="moduleIds"
                        value={m.id}
                        className="mt-0.5 size-4 rounded border-input"
                      />
                      <span>
                        <span className="font-medium">{m.name}</span>{" "}
                        <span className="text-muted-foreground">
                          · {m.brand} · {m.equipmentName}
                        </span>
                        {m.serialNumber ? (
                          <span className="block font-mono text-xs text-muted-foreground">
                            {m.serialNumber}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  ))
                )}
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Opcional. Si vas a diagnosticar y todavía no sabes qué falla, déjalo en
            blanco.
          </p>
        </div>
      ) : null}

      <div>
        <Label htmlFor="destination">{unico ? "Destino" : "Ciudad o ruta del viaje"}</Label>
        <Input
          id="destination"
          name="destination"
          required
          maxLength={200}
          placeholder={unico ? "Ej. Monterrey, N. L." : "Ej. Monterrey – Saltillo, Coah."}
          value={destino}
          onChange={(e) => setDestino(e.target.value)}
        />
      </div>


      <div>
        <Label htmlFor="purpose">Motivo del viaje</Label>
        <Textarea
          id="purpose"
          name="purpose"
          required
          rows={3}
          placeholder="Qué se va a hacer y por qué hay que ir en persona."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="departsOn">Salida</Label>
          <Input id="departsOn" name="departsOn" type="date" required />
        </div>
        <div>
          <Label htmlFor="returnsOn">Regreso</Label>
          <Input id="returnsOn" name="returnsOn" type="date" required />
        </div>
        <div>
          <Label htmlFor="estimatedMxn">Estimado con IVA (MXN)</Label>
          <Input
            id="estimatedMxn"
            name="estimatedMxn"
            inputMode="decimal"
            required
            placeholder="0.00"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="approverId">¿Quién lo autoriza?</Label>
        {/*
          OBLIGATORIO, Y CON UNA SOLA PERSONA.

          Antes la solicitud se le anunciaba a todo el que pudiera firmar y la
          resolvía el primero que la viera. Con dos personas funciona; con seis,
          cada una supone que la mirará otra. Ahora quien pide dice a quién se
          lo manda, y solo esa persona firma.

          La lista es la de quien PUEDE administrar viáticos —no la de quien
          tiene tal rol—, así que incluye al agente veterano a quien se le dio
          ese permiso por su hoja y excluye a quien se lo quitaron. Sale de la
          misma función que reparte los avisos, para que no pueda elegirse a
          alguien que después no puede firmar. Y no aparece uno mismo: no se
          firma lo que uno pide.
        */}
        <Selector
          id="approverId"
          name="approverId"
          required
          placeholder="Elige a quién se lo mandas…"
          opciones={aprobadores.map((a) => ({
            value: a.id,
            label: a.name ?? "Sin nombre",
            detalle: ROL_LABEL[a.role] ?? a.role,
          }))}
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          Le llega el aviso y es quien lo firma. Si no está, alguien de
          Administración puede reasignarlo.
        </p>
      </div>

      {state.error ? (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button asChild variant="ghost">
          <Link href="/admin/viaticos">Cancelar</Link>
        </Button>
        <Button type="submit" variant="accent" disabled={pending}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plane className="size-4" />
          )}
          Crear borrador
        </Button>
      </div>
    </form>
  );
}

/**
 * DAR DE ALTA UN PROSPECTO SIN SALIR DEL FORMULARIO.
 *
 * El caso es concreto y pasa siempre: el ingeniero va a pedir el viaje, abre el
 * desplegable y la empresa no está. Mandarlo a Ventas → Prospectos → Nuevo le
 * cuesta perder lo que ya escribió —fechas, motivo, monto—, así que lo que hace
 * en la práctica es elegir cualquier otra y arreglarlo «luego». Ese «luego» es
 * de donde salen las fichas duplicadas.
 *
 * ── POR QUÉ NO ES UN `<form>` ──────────────────────────────────────────────
 *
 * Porque estaría DENTRO del formulario del viático, y el HTML no admite formas
 * anidadas: el navegador cierra la de fuera al abrir la de dentro y el botón de
 * guardar el viático deja de enviar la mitad de los campos. Así que la acción se
 * llama a mano con un `FormData` armado aquí. Es exactamente lo que hace un
 * `<form>`, sin la etiqueta.
 *
 * ── LOS TRES CAMPOS, Y NI UNO MÁS ──────────────────────────────────────────
 *
 * Nombre, municipio y estado. Lo demás —RFC, giro, sitio, teléfono— se captura
 * en la ficha de Ventas, que es donde alguien tiene esos datos delante. Aquí
 * solo hace falta lo que este formulario necesita: a quién se viaja y a dónde.
 * Municipio y estado no son adorno: son los que proponen el destino y los que
 * hacen que el viaje agrupe después en los informes.
 */
function AltaProspectoRapida({
  onCreado,
}: {
  onCreado: (nuevo: ProspectoOpcion) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [municipio, setMunicipio] = useState("");
  const [estado, setEstado] = useState("");

  async function guardar() {
    const limpio = nombre.trim();
    if (!limpio) {
      setError("Escribe el nombre de la empresa.");
      return;
    }
    setGuardando(true);
    setError(null);

    const fd = new FormData();
    fd.set("name", limpio);
    if (municipio.trim()) fd.set("municipality", municipio.trim());
    if (estado.trim()) fd.set("state", estado.trim());

    const res = await createOrganization({ ok: false }, fd);
    setGuardando(false);

    if (!res.ok || !res.id) {
      // Los errores de esta acción son códigos («auth», «invalid», «server»),
      // no frases: se traducen aquí porque enseñarle «invalid» a quien acaba de
      // teclear un nombre no le dice qué corregir.
      setError(
        res.error === "auth"
          ? "No tienes permiso para dar de alta prospectos."
          : res.error === "invalid"
            ? "Revisa el nombre: falta o es demasiado largo."
            : "No se pudo guardar. Inténtalo otra vez.",
      );
      return;
    }

    const sugerencia =
      municipio.trim() && estado.trim() ? `${municipio.trim()}, ${estado.trim()}` : null;
    onCreado({
      id: res.id,
      name: limpio,
      // Recién nacido: no tiene oportunidades ni domicilio desarmado más allá
      // de lo que se acaba de teclear.
      domicilio: { sugerencia, completo: sugerencia, crudo: null, seña: null },
      negocios: [],
    });
    setAbierto(false);
    setNombre("");
    setMunicipio("");
    setEstado("");
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="mt-2 flex items-center gap-1.5 text-xs text-primary hover:underline"
      >
        <Plus className="size-3.5" />
        No está en la lista: darlo de alta
      </button>
    );
  }

  return (
    <div className="mt-2 grid gap-2.5 rounded-lg border border-border bg-muted/40 p-3">
      <p className="text-xs font-medium">Nuevo prospecto</p>
      <Input
        placeholder="Nombre de la empresa"
        value={nombre}
        maxLength={200}
        onChange={(e) => setNombre(e.target.value)}
      />
      <div className="grid grid-cols-2 gap-2">
        <Input
          placeholder="Municipio"
          value={municipio}
          maxLength={120}
          onChange={(e) => setMunicipio(e.target.value)}
        />
        <Input
          placeholder="Estado"
          value={estado}
          maxLength={120}
          onChange={(e) => setEstado(e.target.value)}
        />
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setAbierto(false)}
        >
          Cancelar
        </Button>
        {/*
          `type="button"` en los dos, y no es un detalle: dentro de un formulario
          el botón por omisión es `submit`, así que sin esto el de guardar el
          prospecto enviaría el viático a medio llenar.
        */}
        <Button type="button" size="sm" onClick={guardar} disabled={guardando}>
          {guardando ? <Loader2 className="size-4 animate-spin" /> : null}
          Guardar y elegir
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Queda a tu nombre en Ventas. El resto de la ficha —RFC, giro, contacto—
        se completa allá.
      </p>
    </div>
  );
}
