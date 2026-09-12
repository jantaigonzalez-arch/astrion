"use client";

import { useActionState, useState } from "react";
import {
  Inbox,
  Loader2,
  Check,
  X,
  Building2,
  Mail,
  Users2,
  Clock,
  KeyRound,
  AlertTriangle,
} from "lucide-react";
import { approveSignup, rejectSignup, type ReviewState } from "@/lib/actions/platform";
import type { SignupRow } from "@/lib/data/platform";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Telefono } from "@/components/portal/telefono";
import { cn } from "@/lib/utils";

/**
 * Bandeja de solicitudes de alta.
 *
 * Es el otro extremo del formulario público: aquí una fila declarada por un
 * desconocido se convierte —o no— en un inquilino con su esquema de Postgres.
 * Aprobar es caro e irreversible en la práctica (crea decenas de tablas), así
 * que la pantalla muestra todo lo que el operador necesita para decidir sin
 * salir de ella, y deja el identificador editable hasta el último momento.
 */

const initial: ReviewState = { ok: false };

const PLANS = ["poc", "starter", "pro", "enterprise"] as const;

export function SignupInbox({ rows }: { rows: SignupRow[] }) {
  const pending = rows.filter((r) => r.status === "pending");
  const resolved = rows.filter((r) => r.status !== "pending");

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Inbox className="size-4 text-primary" />
          <h2 className="font-semibold">Solicitudes de alta</h2>
          {pending.length > 0 && (
            <Badge className="bg-warning/15 text-warning ring-1 ring-warning/25">
              {pending.length} por revisar
            </Badge>
          )}
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">
          {resolved.length} resuelta(s)
        </span>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        Empresas que pidieron entrar desde la web. Nada de esto tiene acceso
        todavía: aprobar es lo que crea el esquema, la cuenta del dueño y su
        membresía.
      </p>

      {pending.length === 0 && (
        <p className="mt-5 rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
          Sin solicitudes pendientes.
        </p>
      )}

      <div className="mt-5 grid gap-4">
        {pending.map((s) => (
          <SignupCard key={s.id} s={s} />
        ))}
      </div>

      {resolved.length > 0 && (
        <div className="mt-6 border-t border-border pt-4">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Ya resueltas
          </h3>
          <ul className="mt-3 grid gap-2">
            {resolved.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
              >
                <Badge
                  className={cn(
                    "ring-1",
                    s.status === "approved"
                      ? "bg-success/15 text-success ring-success/25"
                      : "bg-muted text-muted-foreground ring-border",
                  )}
                >
                  {s.status === "approved" ? "Aprobada" : "Rechazada"}
                </Badge>
                <span className="font-medium">{s.companyName}</span>
                <span className="text-muted-foreground">{s.email}</span>
                {s.tenantSlug && (
                  <span className="font-mono text-xs text-muted-foreground">
                    → {s.tenantSlug}
                  </span>
                )}
                {s.rejectionReason && (
                  <span className="text-xs text-muted-foreground">
                    · {s.rejectionReason}
                  </span>
                )}
                <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                  {s.reviewerName ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function SignupCard({ s }: { s: SignupRow }) {
  const [okState, approve, approving] = useActionState(approveSignup, initial);
  const [noState, reject, rejecting] = useActionState(rejectSignup, initial);
  const [slug, setSlug] = useState(s.desiredSlug ?? "");
  const [rechazando, setRechazando] = useState(false);

  const when = new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(s.createdAt));

  // Ya aprobada en esta misma pantalla: se sustituye la ficha por las
  // credenciales, que es lo único que el operador todavía necesita de aquí.
  if (okState.ok && okState.credentials) {
    return <ApprovedCard state={okState} />;
  }
  if (noState.ok) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{s.companyName}</span> —
        solicitud rechazada.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Building2 className="size-4 shrink-0 text-primary" />
            <span className="font-medium">{s.companyName}</span>
            {s.industry && (
              <Badge className="bg-secondary text-secondary-foreground">
                {s.industry}
              </Badge>
            )}
            {s.attempts > 1 && (
              <Badge className="bg-warning/15 text-warning ring-1 ring-warning/25">
                {s.attempts} intentos
              </Badge>
            )}
            <Badge className="bg-secondary text-secondary-foreground">
              {s.locale.toUpperCase()}
            </Badge>
          </div>

          <div className="mt-2 grid gap-x-5 gap-y-1 text-sm text-muted-foreground sm:grid-cols-2">
            <span className="flex items-center gap-1.5">
              <Users2 className="size-3.5" /> {s.contactName}
              {s.size && <span className="text-xs">· {s.size}</span>}
            </span>
            <span className="flex items-center gap-1.5">
              <Mail className="size-3.5" />
              <a className="hover:underline" href={`mailto:${s.email}`}>
                {s.email}
              </a>
            </span>
            <Telefono valor={s.phone} className="flex gap-1.5" />
            <span className="flex items-center gap-1.5">
              <Clock className="size-3.5" /> {when}
            </span>
          </div>

          {s.note && (
            <p className="mt-3 border-l-2 border-border pl-3 text-sm text-muted-foreground">
              {s.note}
            </p>
          )}
        </div>
      </div>

      {!rechazando ? (
        <form action={approve} className="mt-4 border-t border-border pt-4">
          <input type="hidden" name="id" value={s.id} />
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
            <div className="grid gap-1.5">
              <Label htmlFor={`slug-${s.id}`}>Identificador</Label>
              <Input
                id={`slug-${s.id}`}
                name="slug"
                required
                value={slug}
                pattern="[a-z][a-z0-9_]{1,39}"
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
              />
              <span
                className={cn(
                  "font-mono text-[11px]",
                  s.slugTaken && slug === s.desiredSlug
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {s.slugTaken && slug === s.desiredSlug
                  ? "Ese identificador ya está ocupado: cámbialo."
                  : `esquema: tenant_${slug || "…"}`}
              </span>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor={`plan-${s.id}`}>Plan</Label>
              <select
                id={`plan-${s.id}`}
                name="plan"
                defaultValue="poc"
                className="h-10 rounded-lg border border-border bg-background px-3 text-sm"
              >
                {PLANS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <Button type="submit" variant="accent" disabled={approving}>
              {approving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              {approving ? "Creando…" : "Aprobar"}
            </Button>

            <Button
              type="button"
              variant="outline"
              disabled={approving}
              onClick={() => setRechazando(true)}
            >
              <X className="size-4" /> Rechazar
            </Button>
          </div>

          {okState.error && (
            <p className="mt-3 text-sm text-destructive">{okState.error}</p>
          )}
        </form>
      ) : (
        <form action={reject} className="mt-4 border-t border-border pt-4">
          <input type="hidden" name="id" value={s.id} />
          <Label htmlFor={`reason-${s.id}`}>Motivo del rechazo</Label>
          <Textarea
            id={`reason-${s.id}`}
            name="reason"
            required
            rows={2}
            className="mt-1.5"
            placeholder="Queda registrado. Sirve para sostener la decisión si alguien pregunta después."
          />
          <div className="mt-3 flex gap-2">
            <Button type="submit" variant="outline" disabled={rejecting}>
              {rejecting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <X className="size-4" />
              )}
              Confirmar rechazo
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRechazando(false)}
              disabled={rejecting}
            >
              Cancelar
            </Button>
          </div>
          {noState.error && (
            <p className="mt-3 text-sm text-destructive">{noState.error}</p>
          )}
        </form>
      )}
    </div>
  );
}

/**
 * Credenciales recién creadas. Se muestran una sola vez: no se guardan en
 * claro en ningún lado, así que si el operador cierra sin copiarlas el camino
 * es restablecer la contraseña, no recuperarla.
 */
/** Lo que queda de un alta hecha: el mensaje y, si la cuenta es nueva, su acceso. */
export function ApprovedCard({ state }: { state: ReviewState }) {
  const c = state.credentials!;
  return (
    <div className="rounded-lg border border-success/40 bg-success/5 p-4">
      <p className="flex items-center gap-2 text-sm font-medium text-success">
        <Check className="size-4" /> {state.message}
      </p>

      {c.nuevo ? (
        <div className="mt-3">
          <p className="flex items-center gap-2 text-sm">
            <KeyRound className="size-4 text-primary" />
            Acceso del dueño — entrégaselo por un canal seguro:
          </p>
          <div className="mt-2 grid gap-1 rounded-md bg-background p-3 font-mono text-sm">
            <span>{c.email}</span>
            <span className="select-all font-semibold">{c.password}</span>
          </div>
          <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            Esta contraseña no vuelve a mostrarse. Si la pierdes, hay que
            restablecerla.
          </p>
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          <span className="font-mono">{c.email}</span> ya tenía cuenta en la
          plataforma: se le agregó la membresía de dueño y entra con su
          contraseña de siempre.
        </p>
      )}
    </div>
  );
}
