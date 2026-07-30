import { Badge } from "@/components/ui/badge";
import {
  STATUS_LABELS,
  STATUS_STYLES,
  PRIORITY_LABELS,
  PRIORITY_STYLES,
  label,
  type TicketStatusValue,
  type TicketPriorityValue,
} from "@/lib/tickets";

export function StatusBadge({
  status,
  locale,
}: {
  status: TicketStatusValue;
  locale: string;
}) {
  return (
    <Badge className={STATUS_STYLES[status]}>
      {label(STATUS_LABELS, status, locale)}
    </Badge>
  );
}

export function PriorityBadge({
  priority,
  locale,
}: {
  priority: TicketPriorityValue;
  locale: string;
}) {
  return (
    <Badge className={PRIORITY_STYLES[priority]}>
      {label(PRIORITY_LABELS, priority, locale)}
    </Badge>
  );
}
