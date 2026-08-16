import { Badge } from "@/components/ui/badge";
import type { PurchaseOrderStatus } from "@/lib/db/schema";
import { PURCHASE_STATUS_LABEL } from "@/lib/domain/purchasing";

/**
 * El estado de una orden, con color.
 *
 * `partial` va en ámbar y no en verde a propósito: una orden parcial parece
 * cerrada de reojo —ya llegó algo— y es justamente la que se olvida. El color
 * de aviso es lo que la mantiene en el radar hasta que llega el resto.
 */
const STYLE: Record<PurchaseOrderStatus, string> = {
  draft: "bg-secondary text-muted-foreground ring-border",
  sent: "bg-primary/10 text-primary ring-primary/20",
  partial: "bg-warning/10 text-warning ring-warning/25",
  received: "bg-success/10 text-success ring-success/25",
  cancelled: "bg-destructive/10 text-destructive ring-destructive/25",
};

export function PurchaseStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return <Badge className={STYLE[status]}>{PURCHASE_STATUS_LABEL[status]}</Badge>;
}
