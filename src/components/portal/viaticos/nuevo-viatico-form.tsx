"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Loader2, MapPin, Plane, Plus } from "lucide-react";
import { crearViaticoAction, type ViaticoState } from "@/lib/actions/viaticos";
import { Link } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Selector } from "@/components/ui/selector";
import { createOrganization } from "@/lib/actions/crm";
import { ROLE_LABELS } from "@/lib/roles";

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

export type ProspectoOpcion = {
  id: string;
  name: string;
  domicilio: Domicilio;
  /** Sus oportunidades abiertas, ya cargadas. Puede ir vacío. */
  negocios: Array<{ id: string; reference: string; title: string }>;
};

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
/**
 * Pedir viáticos.
 *
 * ── EL ASUNTO MANDA SOBRE TODO LO DEMÁS ────────────────────────────────────
 *
 * Un viaje es a un CONTRATO —ir a atender lo que ya se vendió— o a un
 * PROSPECTO —ir a ver a quien todavía no compra—, y de esa elección cuelga el
 * resto del formulario: los módulos solo existen del lado del contrato, el
 * negocio solo del lado del prospecto.
 *
 * Se pinta como dos pestañas y no como un desplegable con dos opciones porque
 * no es un dato más: es la pregunta que cambia el formulario entero, y esconder
 * eso dentro de un `<select>` hace que la mitad de los campos aparezca y
 * desaparezca sin que se vea por qué.
 *
 * La pestaña de prospectos solo está cuando la empresa lo permite Y quien mira
 * tiene acceso a Ventas. Cuando no, el formulario es exactamente el de antes:
 * ni una pestaña sola ni una opción deshabilitada que invite a preguntar por
 * qué no se puede.
 *
 * ── LO CARGADO POR ADELANTADO ──────────────────────────────────────────────
 *
 * Módulos y negocios viajan YA CARGADOS con cada contrato y cada prospecto en
 * vez de pedirse al cambiar el desplegable: son unos cientos en total para toda
 * la empresa, caben de sobra en la respuesta, y así el segundo campo se llena
 * sin esperar a la red. Es el mismo trato que hace el formulario de ticket
 * nuevo con equipos y módulos.
 */
export function NuevoViaticoForm({
  contratos,
  prospectos,
  aprobadores,
  permiteProspectos,
  puedeCrearProspectos,
}: {
  contratos: ContratoOpcion[];
  prospectos: ProspectoOpcion[];
  aprobadores: Array<{ id: string; name: string | null; role: string }>;
  /** La empresa lo permite y quien mira puede ver Ventas. Ver `domain/viaticos.ts`. */
  permiteProspectos: boolean;
  /** Además puede dar de alta uno sin salir de aquí (`ventas: editar`). */
  puedeCrearProspectos: boolean;
}) {
  const [state, action, pending] = useActionState(crearViaticoAction, initial);
  const [asunto, setAsunto] = useState<"contrato" | "prospecto">("contrato");
  const [contractId, setContractId] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [destino, setDestino] = useState("");
  /*
    Los prospectos dados de alta aquí mismo, sin recargar.

    Se guardan en estado en vez de recargar la página porque la alternativa es
    perder lo que ya se escribió —fechas, motivo, monto— por haber caído en la
    cuenta a media captura de que la empresa no estaba dada de alta. Ese es el
    momento en que ocurre de verdad.
  */
  const [reciennacidos, setReciennacidos] = useState<ProspectoOpcion[]>([]);

  const todosLosProspectos = [...reciennacidos, ...prospectos];
  const contrato = contratos.find((c) => c.id === contractId);
  const prospecto = todosLosProspectos.find((p) => p.id === organizationId);
  const modulos = contrato?.modulos ?? [];

  /*
    El domicilio y el nombre salen del asunto elegido, sea cual sea.

    Antes esto leía `elegido.domicilio` del contrato directamente. Con dos tipos
    de asunto, la alternativa era duplicar el bloque de domicilio entero; y dos
    copias de esa lógica —que ya tiene tres casos— es donde una se queda sin
    arreglar cuando alguien corrige la otra.
  */
  const dom = asunto === "contrato" ? contrato?.domicilio : prospecto?.domicilio;
  const aQuien =
    asunto === "contrato" ? (contrato?.cliente ?? "El cliente") : prospecto?.name;
  const hayAsunto = asunto === "contrato" ? Boolean(contrato) : Boolean(prospecto);

  /**
   * Elegir asunto propone el destino, y NO pisa lo que ya se escribió.
   *
   * El destino de un viático es casi siempre donde está la empresa, así que
   * teclearlo a mano es copiar un dato que el sistema ya tiene — y cada copia a
   * mano es una ciudad mal escrita que después no agrupa en ningún informe.
   *
   * Solo se rellena si el campo está VACÍO o si lo que hay es la sugerencia
   * anterior. Es la diferencia entre ayudar y estorbar: quien viaja a un sitio
   * distinto al domicilio fiscal —una planta, otra sucursal— lo escribe, y
   * cambiar de contrato no se lo borra.
   */
  function proponerDestino(previa: string | null | undefined, nueva: string | null) {
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
   * justo en el caso en que más ayuda —acabas de teclear el municipio dos
   * campos más arriba—.
   */
  function elegirProspecto(id: string, recien?: ProspectoOpcion) {
    proponerDestino(
      prospecto?.domicilio.sugerencia,
      (recien ?? todosLosProspectos.find((p) => p.id === id))?.domicilio.sugerencia ??
        null,
    );
    setOrganizationId(id);
  }

  /** Cambiar de pestaña limpia la elección de la otra, no la conserva escondida. */
  function cambiarAsunto(nuevo: "contrato" | "prospecto") {
    if (nuevo === asunto) return;
    setAsunto(nuevo);
    setContractId("");
    setOrganizationId("");
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

  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="asunto" value={asunto} />

      {permiteProspectos ? (
        <div>
          <Label>¿A quién se viaja?</Label>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {(
              [
                ["contrato", "Cliente con contrato", "El gasto va a su utilidad"],
                ["prospecto", "Prospecto", "Todavía no nos ha comprado"],
              ] as const
            ).map(([valor, titulo, pie]) => (
              <button
                key={valor}
                type="button"
                onClick={() => cambiarAsunto(valor)}
                aria-pressed={asunto === valor}
                className={`rounded-lg border px-3 py-2.5 text-left transition ${
                  asunto === valor
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted"
                }`}
              >
                <span className="block text-sm font-medium">{titulo}</span>
                <span className="block text-xs text-muted-foreground">{pie}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {asunto === "contrato" ? (
        <div>
          <Label htmlFor="contractId">Contrato de servicio</Label>
          {/*
            Con búsqueda: los folios de contrato empiezan todos por las mismas
            letras, así que el tecleo del navegador —que casa contra el prefijo—
            no llega a ninguno. El cliente va en el segundo renglón porque es lo
            único que distingue un folio de otro a ojo. Ver `ui/selector.tsx`.
          */}
          <Selector
            id="contractId"
            name="contractId"
            required
            placeholder="Elige un contrato…"
            opciones={contratos.map((c) => ({
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
            El gasto de este viaje se le carga a la utilidad de este contrato.
          </p>
        </div>
      ) : (
        <div className="grid gap-5">
          <div>
            <Label htmlFor="organizationId">Prospecto</Label>
            {/*
              LA `key` FUERZA EL REMONTAJE CUANDO NACE UNO NUEVO.

              `Selector` guarda su propio valor por dentro y solo lee
              `defaultValue` al montarse, así que elegir desde fuera —que es lo
              que hace el alta rápida— no movía lo que se ve NI lo que se envía:
              el formulario habría mandado el campo vacío con el prospecto recién
              creado en pantalla.

              La `key` cuenta los recién nacidos, no el prospecto elegido: así
              solo se remonta al dar de alta uno, y elegir de la lista a mano
              —el caso normal— no tira el estado del desplegable.
            */}
            <Selector
              key={`prospectos-${reciennacidos.length}`}
              id="organizationId"
              name="organizationId"
              required
              defaultValue={organizationId}
              placeholder="Elige un prospecto…"
              opciones={todosLosProspectos.map((p) => ({
                value: p.id,
                label: p.name,
                detalle: p.domicilio.sugerencia,
                buscar: p.domicilio.completo,
              }))}
              onChange={elegirProspecto}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Empresas sin ninguna compra registrada. En cuanto compren, pasan a
              Clientes con su historial.
            </p>
            {puedeCrearProspectos ? (
              <AltaProspectoRapida
                onCreado={(nuevo) => {
                  setReciennacidos((previos) => [nuevo, ...previos]);
                  elegirProspecto(nuevo.id, nuevo);
                }}
              />
            ) : null}
          </div>

          {prospecto ? (
            <div>
              <Label htmlFor="dealId">Negocio (opcional)</Label>
              {prospecto.negocios.length === 0 ? (
                <p className="mt-1 rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                  Este prospecto no tiene oportunidades abiertas. El viaje se
                  registra igual: el gasto queda como comercial.
                </p>
              ) : (
                <Selector
                  key={prospecto.id}
                  id="dealId"
                  name="dealId"
                  placeholder="Sin negocio concreto"
                  opciones={prospecto.negocios.map((n) => ({
                    value: n.id,
                    label: n.title,
                    detalle: n.reference,
                  }))}
                />
              )}
              <p className="mt-1.5 text-xs text-muted-foreground">
                Si el viaje es por una oportunidad concreta, dilo aquí y el costo
                se podrá leer en su ficha. Si vas a prospectar sin más, déjalo en
                blanco.
              </p>
            </div>
          ) : null}
        </div>
      )}

      {asunto === "contrato" && contractId ? (
        <div>
          <Label>Módulos que vas a atender</Label>
          {modulos.length === 0 ? (
            <p className="mt-1 rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              Este contrato no tiene módulos capturados. Puedes seguir sin
              marcar ninguno.
            </p>
          ) : (
            <>
              <div className="mt-1 max-h-52 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                {modulos.map((m) => (
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
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Opcional. Si vas a diagnosticar y todavía no sabes qué falla,
                déjalo en blanco.
              </p>
            </>
          )}
        </div>
      ) : null}

      <div>
        <Label htmlFor="destination">Destino</Label>
        <Input
          id="destination"
          name="destination"
          required
          maxLength={200}
          placeholder="Ej. Monterrey, N. L."
          value={destino}
          onChange={(e) => setDestino(e.target.value)}
        />

        {/*
          EL DOMICILIO DEL CLIENTE, CON SUS TRES CASOS DICHOS.

          De los contratos de hoy, unos tienen municipio y estado capturados,
          otros solo el domicilio en texto libre sin desarmar, y otros nada. Los
          tres se enseñan distinto a propósito: enseñar los tres igual —o callar
          los dos últimos— convertiría «no hay dato» en «el sistema no funciona»,
          y quien viaja no sabría si el hueco es del cliente o de la pantalla.
        */}
        {hayAsunto ? (
          <div className="mt-2 rounded-lg bg-muted/60 px-3 py-2 text-xs">
            {dom?.completo ? (
              <p className="flex items-start gap-1.5 text-muted-foreground">
                <MapPin className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  <span className="font-medium text-foreground">{aQuien}</span>{" "}
                  · {dom.completo}
                  {dom.seña ? (
                    <span className="block text-muted-foreground">{dom.seña}</span>
                  ) : null}
                </span>
              </p>
            ) : dom?.crudo ? (
              <p className="flex items-start gap-1.5 text-muted-foreground">
                <MapPin className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {dom.crudo}
                  <span className="block">
                    Domicilio sin desarmar: escribe el destino a mano.
                  </span>
                </span>
              </p>
            ) : (
              <p className="text-muted-foreground">
                {asunto === "contrato" ? "Este cliente" : "Este prospecto"} no
                tiene domicilio capturado. Escribe el destino a mano.
              </p>
            )}
            {dom?.sugerencia && destino !== dom.sugerencia ? (
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
