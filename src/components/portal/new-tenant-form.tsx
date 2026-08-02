"use client";

import { useActionState, useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import { createTenant, type PlatformState } from "@/lib/actions/platform";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: PlatformState = { ok: false };

/**
 * Alta de empresa. Un envío crea el esquema de Postgres, aplica todas las
 * migraciones de inquilino y deja al superadministrador como dueño de la
 * cuenta — la operación completa, no un registro que alguien debe terminar
 * a mano después.
 */
export function NewTenantForm() {
  const [state, action, pending] = useActionState(createTenant, initial);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);

  // El identificador se propone desde el nombre, pero es editable: pasa a ser
  // el nombre del esquema y renombrarlo después es caro.
  const suggest = (v: string) =>
    v
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <Plus className="size-4 text-primary" />
        <h2 className="font-semibold">Dar de alta una empresa</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Crea su esquema aislado en Postgres y aplica las migraciones. Los folios
        de la nueva empresa arrancan en uno, sin relación con los de las demás.
      </p>

      <form action={action} className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor="t-name">Nombre</Label>
          <Input
            id="t-name"
            name="name"
            required
            value={name}
            placeholder="ACME Laboratorios"
            onChange={(e) => {
              setName(e.target.value);
              if (!touched) setSlug(suggest(e.target.value));
            }}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="t-slug">Identificador</Label>
          <Input
            id="t-slug"
            name="slug"
            required
            value={slug}
            pattern="[a-z][a-z0-9_]{1,39}"
            placeholder="acme"
            onChange={(e) => {
              setTouched(true);
              setSlug(suggest(e.target.value));
            }}
          />
          <span className="font-mono text-[11px] text-muted-foreground">
            esquema: tenant_{slug || "…"}
          </span>
        </div>

        <Button type="submit" variant="accent" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {pending ? "Creando…" : "Crear"}
        </Button>
      </form>

      {state.error && (
        <p className="mt-3 text-sm text-destructive">{state.error}</p>
      )}
      {state.ok && state.message && (
        <p className="mt-3 text-sm text-success">{state.message}</p>
      )}
    </Card>
  );
}
