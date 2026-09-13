"use client";

import { useActionState, useState } from "react";
import { Building2, Loader2, Save } from "lucide-react";
import {
  guardarPoliticaClientes,
  type ClientesConfigState,
} from "@/lib/actions/clientes-config";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  POLITICAS_69B,
  POLITICA_69B_LABELS,
  PRUEBAS_DE_CLIENTE,
  PRUEBA_LABELS,
  type Politica69b,
  type PruebaDeCliente,
} from "@/lib/politica-clientes";

const initial: ClientesConfigState = { ok: false };
const selectCls =
  "mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm";

export type PoliticaClientes = {
  slaHoras: number;
  usoCfdi: string | null;
  pruebas: PruebaDeCliente[];
  lista69b: { presunto: Politica69b; definitivo: Politica69b };
};

/**
 * LO QUE DECIDE LA EMPRESA SOBRE SUS CLIENTES (0038).
 *
 * Una tarjeta, un «Guardar», cuatro decisiones —ver `guardarPoliticaClientes`—.
 * Cada una dice qué cambia al moverla, porque quien la toca casi nunca es quien
 * va a notar el efecto: el SLA lo nota el cliente, las pruebas de cliente las
 * nota Ventas cuando le aparecen o le desaparecen empresas.
 *
 * Todos los controles son CONTROLADOS: React 19 reinicia el formulario tras la
 * acción de servidor, y un `defaultValue` volvería a enseñar el valor viejo
 * justo después de guardar el nuevo. Nada va `disabled`: un control
 * deshabilitado no se envía y la acción lo tomaría por su valor de fábrica
 * (ver el skill `decisiones-configurables`).
 */
export function ClientesConfigCard({
  politica,
  usos,
}: {
  politica: PoliticaClientes;
  /** El catálogo de usos de CFDI del SAT; vacío si no está cargado. */
  usos: Array<{ clave: string; descripcion: string }>;
}) {
  const [state, action, pending] = useActionState(guardarPoliticaClientes, initial);
  const [pruebas, setPruebas] = useState<PruebaDeCliente[]>(politica.pruebas);
  const [sla, setSla] = useState(String(politica.slaHoras));
  const [uso, setUso] = useState(politica.usoCfdi ?? "");
  const [presunto, setPresunto] = useState<Politica69b>(politica.lista69b.presunto);
  const [definitivo, setDefinitivo] = useState<Politica69b>(politica.lista69b.definitivo);

  const alternar = (p: PruebaDeCliente) =>
    setPruebas((prev) =>
      prev.includes(p) ? (prev.length > 1 ? prev.filter((x) => x !== p) : prev) : [...prev, p],
    );

  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <Building2 className="size-4 text-primary" /> Cómo trabaja tu empresa con sus clientes
      </h2>

      <form action={action} className="mt-5 grid gap-6">
        {/* ── SLA general ── */}
        <div>
          <Label htmlFor="slaHoras">Primera respuesta comprometida (SLA general)</Label>
          <div className="mt-1 flex items-center gap-2">
            <Input
              id="slaHoras"
              name="slaHoras"
              type="number"
              min={1}
              max={720}
              step={1}
              value={sla}
              onChange={(e) => setSla(e.target.value)}
              className="w-28"
            />
            <span className="text-sm text-muted-foreground">horas</span>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Rige para todo cliente que no haya pactado un plazo propio en su ficha.
            Se fija en cada ticket al levantarlo: cambiarlo aquí no mueve el
            vencimiento de los que ya entraron.
          </p>
        </div>

        {/* ── Uso de CFDI por omisión ── */}
        <div>
          <Label htmlFor="usoCfdi">Uso de CFDI con que nace un expediente nuevo</Label>
          {usos.length > 0 ? (
            <select
              id="usoCfdi"
              name="usoCfdi"
              value={uso}
              onChange={(e) => setUso(e.target.value)}
              className={selectCls}
            >
              <option value="">Sin sugerencia</option>
              {usos.map((u) => (
                <option key={u.clave} value={u.clave}>
                  {u.clave} — {u.descripcion}
                </option>
              ))}
            </select>
          ) : (
            <Input
              id="usoCfdi"
              name="usoCfdi"
              value={uso}
              onChange={(e) => setUso(e.target.value.toUpperCase())}
              maxLength={5}
              placeholder="G03"
              className="mt-1 w-32 font-mono"
            />
          )}
          <p className="mt-1.5 text-xs text-muted-foreground">
            Solo es el valor con el que abre el formulario fiscal de un cliente
            nuevo. Al guardar el expediente se valida contra el régimen de ese
            cliente, como siempre.
            {usos.length === 0 ? " Los catálogos del SAT no están cargados: escribe la clave." : ""}
          </p>
        </div>

        {/* ── Qué cuenta como cliente ── */}
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Qué hace cliente a una organización</legend>
          <p className="-mt-1 text-xs text-muted-foreground">
            Basta con UNA de las marcadas. Decide quién aparece en Clientes o en
            Ventas, y a quién se visita o se prospecta en viáticos. Al menos una
            tiene que quedar marcada.
          </p>
          {PRUEBAS_DE_CLIENTE.map((p) => (
            <label
              key={p}
              className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3 text-sm hover:bg-muted/50"
            >
              <input
                type="checkbox"
                name="pruebas"
                value={p}
                checked={pruebas.includes(p)}
                onChange={() => alternar(p)}
                className="mt-0.5 size-4 rounded border-input"
              />
              <span>
                <span className="font-medium">{PRUEBA_LABELS[p].titulo}</span>
                <span className="block text-xs text-muted-foreground">{PRUEBA_LABELS[p].ayuda}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {/* ── Lista 69-B ── */}
        <fieldset className="grid gap-3">
          <legend className="text-sm font-medium">Clientes en la lista 69-B del SAT</legend>
          <p className="-mt-1 text-xs text-muted-foreground">
            Contribuyentes con operaciones presuntamente inexistentes. «Bloquear»
            impide contratos y tickets NUEVOS con ese cliente; lo ya firmado no se
            toca. Los que salieron de la lista (desvirtuado, sentencia favorable)
            no se tratan como listados.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["lista69bPresunto", "Presunto", presunto, setPresunto],
                ["lista69bDefinitivo", "Definitivo", definitivo, setDefinitivo],
              ] as const
            ).map(([campo, titulo, valor, fijar]) => (
              <div key={campo}>
                <Label htmlFor={campo}>{titulo}</Label>
                <select
                  id={campo}
                  name={campo}
                  value={valor}
                  onChange={(e) => fijar(e.target.value as Politica69b)}
                  className={selectCls}
                >
                  {POLITICAS_69B.map((p) => (
                    <option key={p} value={p}>
                      {POLITICA_69B_LABELS[p]}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </fieldset>

        <div className="flex items-center justify-end gap-3">
          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          {state.ok && state.message ? <p className="text-sm text-success">{state.message}</p> : null}
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Guardar
          </Button>
        </div>
      </form>
    </Card>
  );
}
