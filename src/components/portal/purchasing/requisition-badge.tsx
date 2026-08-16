import { Badge } from "@/components/ui/badge";
import type { RequisitionStatus } from "@/lib/db/schema";
import { REQUISITION_STATUS_LABEL } from "@/lib/domain/requisitions";

/**
 * El estado de una requisición, con color.
 *
 * Dos decisiones que se ven poco y pesan:
 *
 *  · `submitted` va en ámbar porque es el ÚNICO estado donde el documento está
 *    parado esperando a una persona. Todos los demás avanzan solos o ya
 *    terminaron; este se queda quieto hasta que alguien lo mire, y por eso es el
 *    que tiene que llamar.
 *  · `partial` también en ámbar, por lo mismo que en la orden de compra: de
 *    reojo parece cerrada —ya salieron órdenes— y es justo la que se olvida con
 *    un renglón sin comprar.
 */
const STYLE: Record<RequisitionStatus, string> = {
  draft: "bg-secondary text-muted-foreground ring-border",
  submitted: "bg-warning/10 text-warning ring-warning/25",
  approved: "bg-primary/10 text-primary ring-primary/20",
  partial: "bg-warning/10 text-warning ring-warning/25",
  ordered: "bg-success/10 text-success ring-success/25",
  rejected: "bg-destructive/10 text-destructive ring-destructive/25",
  cancelled: "bg-destructive/10 text-destructive ring-destructive/25",
};

export function RequisitionStatusBadge({ status }: { status: RequisitionStatus }) {
  return <Badge className={STYLE[status]}>{REQUISITION_STATUS_LABEL[status]}</Badge>;
}
