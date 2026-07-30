"use client";

import { useRef, useState, useTransition } from "react";
import {
  CalendarPlus,
  Loader2,
  MessageSquarePlus,
  ThumbsDown,
  Trophy,
  Undo2,
} from "lucide-react";
import {
  createActivity,
  createNote,
  setDealStatus,
  toggleActivity,
} from "@/lib/actions/crm";
import { ACTIVITY_LABELS, ACTIVITY_TYPES, label } from "@/lib/crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const selectCls =
  "flex h-10 w-full rounded-lg border border-input bg-background px-3.5 text-sm shadow-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

/** Alta rápida de actividad desde la ficha de un negocio u organización. */
export function ActivityQuickForm({
  dealId,
  organizationId,
  contactId,
  locale,
}: {
  dealId?: string;
  organizationId?: string;
  contactId?: string;
  locale: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          await createActivity(fd);
          formRef.current?.reset();
        })
      }
      className="grid gap-3"
    >
      {dealId && <input type="hidden" name="dealId" value={dealId} />}
      {organizationId && (
        <input type="hidden" name="organizationId" value={organizationId} />
      )}
      {contactId && <input type="hidden" name="contactId" value={contactId} />}

      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <select name="type" className={selectCls} defaultValue="call">
          {ACTIVITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {label(ACTIVITY_LABELS, t, locale)}
            </option>
          ))}
        </select>
        <Input
          name="subject"
          required
          placeholder="Ej. Llamar para confirmar la cotización"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <Input name="dueAt" type="datetime-local" aria-label="Vencimiento" />
        <Button type="submit" variant="accent" disabled={pending}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <CalendarPlus className="size-4" />
          )}
          Agendar
        </Button>
      </div>
    </form>
  );
}

/** Checkbox para completar/reabrir una actividad. */
export function ActivityToggle({ id, done }: { id: string; done: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(fd) => startTransition(() => void toggleActivity(fd))}
      className="shrink-0"
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="done" value={done ? "0" : "1"} />
      <button
        type="submit"
        disabled={pending}
        aria-label={done ? "Reabrir actividad" : "Marcar como completada"}
        className={`flex size-5 items-center justify-center rounded-md border transition-colors ${
          done
            ? "border-success bg-success text-white"
            : "border-input hover:border-primary"
        }`}
      >
        {pending ? (
          <Loader2 className="size-3 animate-spin" />
        ) : done ? (
          <svg viewBox="0 0 12 12" className="size-3" fill="none">
            <path
              d="M2.5 6.5l2.5 2.5 4.5-5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </button>
    </form>
  );
}

/** Nota libre en la bitácora del negocio. */
export function NoteForm({
  dealId,
  organizationId,
}: {
  dealId?: string;
  organizationId?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          await createNote(fd);
          formRef.current?.reset();
        })
      }
      className="grid gap-3"
    >
      {dealId && <input type="hidden" name="dealId" value={dealId} />}
      {organizationId && (
        <input type="hidden" name="organizationId" value={organizationId} />
      )}
      <Textarea
        name="body"
        required
        rows={3}
        placeholder="Registra el resultado de la llamada, acuerdos, objeciones…"
      />
      <div className="flex justify-end">
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <MessageSquarePlus className="size-4" />
          )}
          Agregar nota
        </Button>
      </div>
    </form>
  );
}

/** Cierre del negocio: ganado, perdido (con motivo) o reapertura. */
export function DealStatusPanel({
  dealId,
  status,
}: {
  dealId: string;
  status: "open" | "won" | "lost";
}) {
  const [showLost, setShowLost] = useState(false);
  const [pending, startTransition] = useTransition();

  if (status !== "open") {
    return (
      <form action={(fd) => startTransition(() => void setDealStatus(fd))}>
        <input type="hidden" name="dealId" value={dealId} />
        <input type="hidden" name="status" value="open" />
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Undo2 className="size-4" />
          )}
          Reabrir negocio
        </Button>
      </form>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <form action={(fd) => startTransition(() => void setDealStatus(fd))}>
          <input type="hidden" name="dealId" value={dealId} />
          <input type="hidden" name="status" value="won" />
          <Button
            type="submit"
            size="sm"
            disabled={pending}
            className="bg-success text-white hover:brightness-110"
          >
            <Trophy className="size-4" /> Marcar ganado
          </Button>
        </form>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowLost((v) => !v)}
        >
          <ThumbsDown className="size-4" /> Marcar perdido
        </Button>
      </div>

      {showLost && (
        <form
          action={(fd) => startTransition(() => void setDealStatus(fd))}
          className="grid gap-2 rounded-xl border border-border bg-secondary/30 p-3"
        >
          <input type="hidden" name="dealId" value={dealId} />
          <input type="hidden" name="status" value="lost" />
          <Textarea
            name="lostReason"
            rows={2}
            required
            placeholder="Motivo de la pérdida (precio, competencia, sin presupuesto…)"
          />
          <div className="flex justify-end">
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={pending}
              className="border-destructive/40 text-destructive"
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ThumbsDown className="size-4" />
              )}
              Confirmar pérdida
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
