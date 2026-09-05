"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Loader2, MapPin, Plane } from "lucide-react";
import { crearViaticoAction, type ViaticoState } from "@/lib/actions/viaticos";
import { Link } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Selector } from "@/components/ui/selector";

const initial: ViaticoState = { ok: false };

export type ContratoOpcion = {
  id: string;
  number: string;
  cliente: string | null;
  /** El domicilio del cliente, en tres piezas. Ver `data/viaticos.ts`. */
  domicilio: {
    /** «Municipio, Estado». Null si no están los dos capturados. */
    sugerencia: string | null;
    /** La dirección legible, para saber a dónde se va. */
    completo: string | null;
    /** El domicilio sin desarmar, cuando es lo único que hay. */
    crudo: string | null;
    /** Entre qué calles, seña para llegar. */
    seña: string | null;
  };
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
 * ── EL CONTRATO MANDA SOBRE LO DEMÁS ───────────────────────────────────────
 *
 * Elegir contrato acota los módulos a los equipos que ese contrato ampara. Los
 * módulos viajan YA CARGADOS con cada contrato en vez de pedirse al cambiar el
 * desplegable: son ciento y pico en total para toda la empresa, caben de sobra
 * en la respuesta, y así el segundo campo se llena sin esperar a la red. Es el
 * mismo trato que ya hace el formulario de ticket nuevo con equipos y módulos.
 */
export function NuevoViaticoForm({ contratos }: { contratos: ContratoOpcion[] }) {
  const [state, action, pending] = useActionState(crearViaticoAction, initial);
  const [contractId, setContractId] = useState("");
  const [destino, setDestino] = useState("");
  const elegido = contratos.find((c) => c.id === contractId);
  const modulos = elegido?.modulos ?? [];
  const dom = elegido?.domicilio;

  /**
   * Elegir contrato propone el destino, y NO pisa lo que ya se escribió.
   *
   * El destino de un viático es casi siempre donde está el cliente, así que
   * teclearlo a mano es copiar un dato que el sistema ya tiene — y cada copia a
   * mano es una ciudad mal escrita que después no agrupa en ningún informe.
   *
   * Solo se rellena si el campo está VACÍO o si lo que hay es la sugerencia del
   * contrato anterior. Es la diferencia entre ayudar y estorbar: quien viaja a
   * un sitio distinto al domicilio fiscal —una planta, otra sucursal— lo escribe
   * y cambiar de contrato no se lo borra.
   */
  function elegirContrato(id: string) {
    const previo = contratos.find((c) => c.id === contractId)?.domicilio.sugerencia;
    const nueva = contratos.find((c) => c.id === id)?.domicilio.sugerencia ?? "";
    setContractId(id);
    setDestino((actual) => (actual.trim() === "" || actual === previo ? nueva : actual));
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

      {contractId ? (
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
        {elegido ? (
          <div className="mt-2 rounded-lg bg-muted/60 px-3 py-2 text-xs">
            {dom?.completo ? (
              <p className="flex items-start gap-1.5 text-muted-foreground">
                <MapPin className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  <span className="font-medium text-foreground">
                    {elegido.cliente ?? "El cliente"}
                  </span>{" "}
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
                Este cliente no tiene domicilio capturado. Escribe el destino a
                mano.
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
          <Label htmlFor="estimatedMxn">Estimado (MXN)</Label>
          <Input
            id="estimatedMxn"
            name="estimatedMxn"
            inputMode="decimal"
            required
            placeholder="0.00"
          />
        </div>
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
