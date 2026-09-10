"use client";

import { useActionState, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Receipt } from "lucide-react";
import { guardarExpedienteFiscal, type ExpedienteState } from "@/lib/actions/clientes";
import { normalizarNombreFiscal, validarRfc } from "@/lib/domain/fiscal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * EL FORMULARIO DEL EXPEDIENTE FISCAL.
 *
 * ── LO QUE LO HACE DISTINTO DE UN FORMULARIO NORMAL ───────────────────────
 *
 * Dos cosas, y las dos existen para que el error se vea ANTES de guardar y no
 * después, cuando lo devuelve el PAC:
 *
 * 1. ENSEÑA LO QUE SE VA A TIMBRAR. El nombre fiscal se normaliza mientras se
 *    teclea —mayúsculas, sin régimen de capital— y se muestra debajo. Sin esa
 *    vista previa, quien escribe «Comercializadora Ejemplo, S.A. de C.V.» no
 *    tiene forma de saber que el sistema va a mandar otra cosa, y el primer
 *    sitio donde se enteraría sería un rechazo CFDI40147.
 *
 * 2. DERIVA EL TIPO DE PERSONA DEL RFC, y lo dice. No se pregunta: son 12
 *    caracteres para una moral y 13 para una física, y preguntarlo solo abre la
 *    puerta a que no coincidan.
 *
 * ── LA NORMALIZACIÓN SE IMPORTA, NO SE REESCRIBE ──────────────────────────
 *
 * `@/lib/domain/fiscal` es puro —no toca la base ni `server-only`—, así que la
 * misma función que decide qué se guarda es la que pinta la vista previa. Una
 * copia en el cliente se separaría de la del servidor en el primer cambio, y el
 * síntoma sería una vista previa que miente.
 */

export type ExpedienteDefaults = {
  organizationId: string;
  rolFiscal: string;
  rfc: string | null;
  nombreFiscal: string | null;
  nombreCapturado: string | null;
  regimenFiscal: string | null;
  cpFiscal: string | null;
  paisResidencia: string | null;
  numRegIdTrib: string | null;
  curp: string | null;
  usoCfdiDefault: string | null;
  /** El domicilio de la Constancia. Solo su CP se timbra; el resto se guarda igual. */
  domicilio: {
    calle: string | null;
    numExterior: string | null;
    numInterior: string | null;
    colonia: string | null;
    municipio: string | null;
    estado: string | null;
  } | null;
};

export type OpcionSat = { clave: string; descripcion: string };

const inicial: ExpedienteState = { ok: false };

export function ExpedienteFiscalForm({
  defaults,
  regimenes,
  usos,
  nombreOrganizacion,
  rfcDelPadron,
}: {
  defaults: ExpedienteDefaults;
  regimenes: OpcionSat[];
  usos: OpcionSat[];
  /** Nombre comercial de la organización: la semilla del nombre fiscal. */
  nombreOrganizacion: string;
  /** RFC heredado del padrón viejo, para poder adoptarlo de un clic. */
  rfcDelPadron: string | null;
}) {
  const [state, action, pending] = useActionState(guardarExpedienteFiscal, inicial);

  const [rfc, setRfc] = useState(defaults.rfc ?? rfcDelPadron ?? "");
  const [nombre, setNombre] = useState(
    defaults.nombreCapturado ?? defaults.nombreFiscal ?? nombreOrganizacion,
  );
  const [rol, setRol] = useState(defaults.rolFiscal || "normal");

  const analisisRfc = rfc.trim() ? validarRfc(rfc) : null;
  const previo = normalizarNombreFiscal(nombre);
  const cambia = previo.normalizado !== nombre.trim().toUpperCase();

  const err = (campo: string) => state.errores?.find((e) => e.campo === campo);

  const Aviso = ({ campo }: { campo: string }) => {
    const e = err(campo);
    if (!e) return null;
    return (
      <p className="mt-1 flex items-start gap-1 text-xs text-destructive">
        <AlertTriangle className="mt-0.5 size-3 shrink-0" />
        <span>
          <span className="font-mono">{e.codigo}</span> · {e.mensaje}
        </span>
      </p>
    );
  };

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="organizationId" value={defaults.organizationId} />

      {state.ok && (
        <div className="flex items-start gap-2 rounded-lg bg-success/10 p-3 text-sm text-success">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <span>{state.mensaje}</span>
        </div>
      )}
      {state.error && (
        <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {state.error}
        </div>
      )}
      {/*
        LAS ADVERTENCIAS SE ENSEÑAN TAMBIÉN CUANDO TODO SALIÓ BIEN.

        Guardar salió bien; prometer que la factura va a salir, no. Mientras el
        nombre no se haya contrastado contra la Constancia —o mientras falte un
        catálogo del SAT— hay cosas que este sistema no puede saber. Callarlas
        sería enseñar un verde que el PAC va a desmentir.
      */}
      {state.advertencias && state.advertencias.length > 0 && (
        <div className="space-y-1 rounded-lg bg-warning/10 p-3 text-xs text-warning">
          {state.advertencias.map((a, i) => (
            <p key={i} className="flex items-start gap-1">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              <span>{a.mensaje}</span>
            </p>
          ))}
        </div>
      )}

      <div>
        <Label htmlFor="rolFiscal">Tipo de receptor</Label>
        <select
          id="rolFiscal"
          name="rolFiscal"
          value={rol}
          onChange={(e) => setRol(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="normal">Normal — tiene RFC propio</option>
          <option value="publico_general">Público en general — factura global</option>
          <option value="extranjero">Extranjero — sin RFC mexicano</option>
        </select>
        <p className="mt-1 text-xs text-muted-foreground">
          Decide qué se valida. Los dos últimos usan un RFC genérico del SAT y no se
          contrastan contra el padrón.
        </p>
        <Aviso campo="rol_fiscal" />
      </div>

      <div>
        <Label htmlFor="rfc">RFC</Label>
        <Input
          id="rfc"
          name="rfc"
          value={rfc}
          onChange={(e) => setRfc(e.target.value.toUpperCase())}
          maxLength={13}
          className="font-mono uppercase"
          placeholder="AAA010101AA0"
        />
        {analisisRfc?.tipo && (
          <p className="mt-1 text-xs text-muted-foreground">
            {analisisRfc.generico
              ? "RFC genérico del SAT."
              : `Persona ${analisisRfc.tipo === "fisica" ? "física" : "moral"} (${rfc.trim().length} caracteres).`}
          </p>
        )}
        {rfcDelPadron && rfc !== rfcDelPadron && (
          <button
            type="button"
            onClick={() => setRfc(rfcDelPadron)}
            className="mt-1 text-xs text-primary hover:underline"
          >
            Usar el del padrón: {rfcDelPadron}
          </button>
        )}
        <Aviso campo="rfc" />
      </div>

      <div>
        <Label htmlFor="nombreFiscal">Nombre o razón social</Label>
        <Input
          id="nombreFiscal"
          name="nombreFiscal"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Tal como aparece en la Constancia de Situación Fiscal, <strong>sin</strong> el
          régimen de capital (S.A. de C.V., S. de R.L.…).
        </p>
        {nombre.trim() && (
          <p
            className={
              cambia
                ? "mt-1 rounded-md bg-warning/10 px-2 py-1 text-xs text-warning"
                : "mt-1 text-xs text-muted-foreground"
            }
          >
            Se timbrará como:{" "}
            <span className="font-mono font-medium">{previo.normalizado}</span>
            {previo.regimenRemovido && ` · se quita «${previo.regimenRemovido}»`}
          </p>
        )}
        <Aviso campo="nombre_fiscal" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="regimenFiscal">Régimen fiscal</Label>
          {regimenes.length > 0 ? (
            <select
              id="regimenFiscal"
              name="regimenFiscal"
              defaultValue={defaults.regimenFiscal ?? ""}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">Elegir…</option>
              {regimenes.map((r) => (
                <option key={r.clave} value={r.clave}>
                  {r.clave} — {r.descripcion}
                </option>
              ))}
            </select>
          ) : (
            <>
              {/*
                SIN CATÁLOGO CARGADO SE CAPTURA A MANO, y se dice por qué.

                Un desplegable vacío parecería que no hay ningún régimen válido.
                Un campo de texto con el aviso deja trabajar y no miente sobre
                lo que el sistema puede comprobar.
              */}
              <Input
                id="regimenFiscal"
                name="regimenFiscal"
                defaultValue={defaults.regimenFiscal ?? ""}
                maxLength={3}
                className="font-mono"
                placeholder="601"
              />
              <p className="mt-1 text-xs text-warning">
                El catálogo c_RegimenFiscal del SAT no está cargado: se captura a mano y
                no se puede comprobar.
              </p>
            </>
          )}
          <Aviso campo="regimen_fiscal" />
        </div>

        <div>
          <Label htmlFor="usoCfdiHueco" className="opacity-0">
            .
          </Label>
          <p className="mt-2 text-xs text-muted-foreground">
            El régimen tiene que ser el de la Constancia. No el que parezca
            razonable: el SAT lo contrasta.
          </p>
        </div>
      </div>

      {/*
        ── EL DOMICILIO FISCAL VA AQUÍ, CON LOS DATOS FISCALES ─────────────

        Estaba en la ficha de la organización, junto al domicilio comercial —el
        de entrega—, y el código postal fiscal estaba aquí. Dos domicilios en
        dos pantallas, y el de entrega a un clic del que se timbra: es
        exactamente cómo se acaba mandando el CP de la bodega en una factura.

        Ahora el código postal se captura UNA vez, aquí, y alimenta los dos
        sitios: lo que se timbra y el domicilio fiscal guardado. No hay dos
        campos que puedan discrepar porque no hay dos campos.

        Del domicilio entero, el CFDI 4.0 solo lleva el CÓDIGO POSTAL. Lo demás
        se guarda porque es lo que dice la Constancia y porque el día que haga
        falta una Carta Porte ya estará.
      */}
      <fieldset className="rounded-xl border border-border p-4">
        <legend className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Domicilio fiscal
        </legend>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="cpFiscal">Código postal</Label>
            <Input
              id="cpFiscal"
              name="cpFiscal"
              defaultValue={defaults.cpFiscal ?? ""}
              maxLength={5}
              inputMode="numeric"
              className="font-mono"
              placeholder="64000"
            />
            <p className="mt-1 text-xs text-warning">
              Es el único dato del domicilio que viaja en la factura. El de la
              Constancia, <strong>no</strong> el de entrega.
            </p>
            <Aviso campo="cp_fiscal" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="calle">Calle</Label>
            <Input id="calle" name="calle" defaultValue={defaults.domicilio?.calle ?? ""} />
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          <div>
            <Label htmlFor="numExterior">Núm. exterior</Label>
            <Input
              id="numExterior"
              name="numExterior"
              defaultValue={defaults.domicilio?.numExterior ?? ""}
              maxLength={55}
            />
          </div>
          <div>
            <Label htmlFor="numInterior">Núm. interior</Label>
            <Input
              id="numInterior"
              name="numInterior"
              defaultValue={defaults.domicilio?.numInterior ?? ""}
              maxLength={55}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="colonia">Colonia</Label>
            <Input id="colonia" name="colonia" defaultValue={defaults.domicilio?.colonia ?? ""} />
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="municipio">Municipio o alcaldía</Label>
            <Input
              id="municipio"
              name="municipio"
              defaultValue={defaults.domicilio?.municipio ?? ""}
            />
          </div>
          <div>
            <Label htmlFor="estado">Estado</Label>
            <Input id="estado" name="estado" defaultValue={defaults.domicilio?.estado ?? ""} />
          </div>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Este es el domicilio de la Constancia. El domicilio donde se entrega o se
          da servicio se captura en la ficha de la organización.
        </p>
      </fieldset>

      <div>
        <Label htmlFor="usoCfdiDefault">Uso de CFDI por omisión</Label>
        {usos.length > 0 ? (
          <select
            id="usoCfdiDefault"
            name="usoCfdiDefault"
            defaultValue={defaults.usoCfdiDefault ?? ""}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">Sin definir</option>
            {usos.map((u) => (
              <option key={u.clave} value={u.clave}>
                {u.clave} — {u.descripcion}
              </option>
            ))}
          </select>
        ) : (
          <Input
            id="usoCfdiDefault"
            name="usoCfdiDefault"
            defaultValue={defaults.usoCfdiDefault ?? ""}
            maxLength={5}
            className="font-mono"
            placeholder="G01"
          />
        )}
        <Aviso campo="uso_cfdi_default" />
      </div>

      {rol === "extranjero" && (
        <div className="grid gap-4 rounded-lg border border-dashed border-border p-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="paisResidencia">País de residencia</Label>
            <Input
              id="paisResidencia"
              name="paisResidencia"
              defaultValue={defaults.paisResidencia ?? ""}
              maxLength={3}
              className="font-mono uppercase"
              placeholder="USA"
            />
            <Aviso campo="pais_residencia" />
          </div>
          <div>
            <Label htmlFor="numRegIdTrib">Registro tributario</Label>
            <Input
              id="numRegIdTrib"
              name="numRegIdTrib"
              defaultValue={defaults.numRegIdTrib ?? ""}
              maxLength={40}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              El tax ID de su país. Sin él no se puede armar el CFDI.
            </p>
            <Aviso campo="num_reg_id_trib" />
          </div>
        </div>
      )}

      {analisisRfc?.tipo === "fisica" && (
        <div>
          <Label htmlFor="curp">CURP (opcional)</Label>
          <Input
            id="curp"
            name="curp"
            defaultValue={defaults.curp ?? ""}
            maxLength={18}
            className="font-mono uppercase"
          />
          <Aviso campo="curp" />
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Guardando…
            </>
          ) : (
            <>
              <Receipt className="size-4" /> Guardar datos fiscales
            </>
          )}
        </Button>
        <p className="text-xs text-muted-foreground">
          Guardar no valida ante el SAT: eso es un paso aparte.
        </p>
      </div>
    </form>
  );
}
