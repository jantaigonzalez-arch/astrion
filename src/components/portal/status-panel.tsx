"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { updateTicketStatus } from "@/lib/actions/tickets";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  STATUS_LABELS,
  STAFF_SETTABLE_STATUSES,
  label,
} from "@/lib/tickets";

const selectCls =
  "h-9 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

function SaveBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      Guardar
    </Button>
  );
}

/**
 * Cambiar el estado del ticket.
 *
 * ── POR QUÉ ES UN COMPONENTE DE CLIENTE Y NO UN `<form>` EN LA PÁGINA ─────
 *
 * Porque el `<select>` tiene que estar CONTROLADO. Vivía en la página como un
 * formulario suelto con `defaultValue={ticket.status}`, y eso hacía que guardar
 * un estado nuevo dejara el selector enseñando el ANTERIOR: el cambio entraba
 * en la base, la insignia de arriba se actualizaba, y el control desde el que
 * se acababa de cambiar decía otra cosa. Enseñar dos estados distintos en la
 * misma pantalla es peor que no refrescar ninguno, porque no hay forma de saber
 * cuál de los dos miente.
 *
 * Son dos comportamientos de React 19 que se juntan:
 *
 *   1. Un `<form>` cuya `action` es una función SE RESETEA solo al terminar la
 *      acción. Los campos no controlados vuelven a su valor por omisión.
 *   2. En un campo no controlado, `defaultValue` solo se aplica al MONTAR. Un
 *      re-render con otro `defaultValue` no toca el DOM.
 *
 * O sea que el valor por omisión al que vuelve el reseteo es el que tenía la
 * página al abrirse — el estado viejo—, por más que el servidor ya haya mandado
 * el nuevo. La página es dinámica (`ƒ` en el build) y `revalidateTenant()` hace
 * su trabajo: los datos que llegan son frescos. Lo que no se entera es el DOM.
 *
 * `AssignPanel` es el mismo caso y ya estaba resuelto así; su comentario
 * describe exactamente este defecto. Este formulario se quedó atrás.
 *
 * ── Y LA RE-SINCRONIZACIÓN VA POR `key`, NO POR UN EFECTO ────────────────
 *
 * `useState` solo lee su argumento en el PRIMER render, así que hace falta algo
 * que vuelva a alinear el componente cuando el servidor manda un estado
 * distinto del que hay en pantalla —otra pestaña que lo movió, o el panel de
 * revisión de al lado—. Sin eso, el estado de React sería otra fotografía
 * vieja: el mismo defecto una capa más adentro.
 *
 * Quien pone el `key` es la página, con el estado del ticket: cuando cambia,
 * React desmonta y vuelve a montar, y `useState` lee el valor nuevo. Es el
 * «resetear el estado con una key» de la documentación de React.
 *
 * `AssignPanel` lo hace con `useEffect` + `setState`, que es la forma que la
 * propia documentación desaconseja —y que ESLint marca como error—. Aquí no se
 * copia el defecto de al lado por consistencia; se copia la corrección.
 */
export function StatusPanel({
  ticketId,
  status,
  locale,
}: {
  ticketId: string;
  status: string;
  locale: string;
}) {
  const [value, setValue] = useState(status);

  return (
    <Card className="p-5">
      <h3 className="mb-3 text-sm font-semibold">Cambiar estado</h3>
      <form action={updateTicketStatus} className="flex gap-2">
        <input type="hidden" name="ticketId" value={ticketId} />
        <select
          name="status"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={`${selectCls} flex-1`}
        >
          {STAFF_SETTABLE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {label(STATUS_LABELS, s, locale)}
            </option>
          ))}
        </select>
        <SaveBtn />
      </form>
    </Card>
  );
}
