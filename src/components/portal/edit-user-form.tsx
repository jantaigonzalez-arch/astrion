"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Copy, KeyRound, Link2, Loader2, Save } from "lucide-react";
import {
  updateUser,
  resetUserPassword,
  type UpdateUserState,
} from "@/lib/actions/users";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AssignableRole } from "@/lib/roles";
import { PermisosMatriz } from "@/components/portal/permisos-matriz";
import type { Ajustes } from "@/lib/permisos";

const initial: UpdateUserState = { ok: false };
const selectCls =
  "flex h-10 w-full rounded-lg border border-input bg-background px-3.5 text-sm shadow-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

function randomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const sym = "!@#$%&*";
  let out = "";
  const buf = new Uint32Array(10);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 10; i++) out += chars[buf[i] % chars.length];
  const s = new Uint32Array(1);
  crypto.getRandomValues(s);
  return out + sym[s[0] % sym.length] + "9";
}

function ErrorMsg({ error }: { error?: string }) {
  if (!error) return null;
  const map: Record<string, string> = {
    auth: "No autorizado. Solo un administrador puede editar cuentas.",
    invalid: "Revisa los campos (contraseña de 8+ caracteres).",
    self: "No puedes quitarte a ti mismo el rol de administrador ni desactivarte.",
    owner: "La cuenta del dueño no se edita desde aquí: transferir la titularidad es otra operación.",
    server: "Ocurrió un error. Intenta de nuevo.",
  };
  return <p className="text-sm text-destructive">{map[error] ?? error}</p>;
}

export type EditableUser = {
  id: string;
  name: string | null;
  email: string;
  company: string | null;
  phone: string | null;
  role: AssignableRole;
  /** Ajustes de acceso por módulo ya guardados. Ver `lib/permisos.ts`. */
  permisos: Ajustes;
  /** Pertenencia a ESTA empresa, no la cuenta global. Ver `people.ts`. */
  active: boolean;
};

export function EditUserForm({
  user,
  isSelf,
  organizations = [],
  crmOrganizationId = "",
}: {
  user: EditableUser;
  isSelf: boolean;
  /** Organizaciones del CRM disponibles para vincular. */
  organizations?: { id: string; name: string }[];
  /** Organización que hoy representa a esta cuenta ("" = ninguna). */
  crmOrganizationId?: string;
}) {
  const [state, action, pending] = useActionState(updateUser, initial);

  // Controlados: React resetea el form tras la server action, y con
  // defaultValue el select volvería al valor viejo. Se re-sincronizan
  // cuando el servidor revalida con los datos nuevos, ajustando el estado
  // durante el render (patrón recomendado por React) en vez de en un efecto.
  const [role, setRole] = useState(user.role);
  const [active, setActive] = useState(user.active);
  const [orgId, setOrgId] = useState(crmOrganizationId);

  const fromServer = `${user.role}|${user.active}|${crmOrganizationId}`;
  const [prevFromServer, setPrevFromServer] = useState(fromServer);
  if (prevFromServer !== fromServer) {
    setPrevFromServer(fromServer);
    setRole(user.role);
    setActive(user.active);
    setOrgId(crmOrganizationId);
  }

  return (
    <Card className="p-6 sm:p-8">
      <form action={action} className="grid gap-5">
        <input type="hidden" name="id" value={user.id} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="name">Nombre del contacto</Label>
            <Input id="name" name="name" required defaultValue={user.name ?? ""} />
          </div>
          <div>
            <Label htmlFor="company">Laboratorio / Empresa</Label>
            <Input id="company" name="company" defaultValue={user.company ?? ""} />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Correo (no editable)</Label>
            <Input value={user.email} disabled readOnly />
          </div>
          <div>
            <Label htmlFor="phone">Teléfono</Label>
            <Input id="phone" name="phone" defaultValue={user.phone ?? ""} />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="role">Rol</Label>
            <select
              id="role"
              name="role"
              value={role}
              onChange={(e) => setRole(e.target.value as EditableUser["role"])}
              className={selectCls}
            >
              <option value="client">Cliente (laboratorio)</option>
              <option value="agent">Agente (soporte)</option>
              <option value="sales">Vendedor</option>
              <option value="admin">Administrador</option>
            </select>
          </div>
          <div>
            <Label htmlFor="active">Estado</Label>
            <label className="flex h-10 items-center gap-2.5 rounded-lg border border-input px-3.5 text-sm">
              <input
                id="active"
                name="active"
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="size-4 rounded border-input"
              />
              Pertenece a esta empresa
            </label>
          </div>
        </div>

        {/*
          La matriz va DESPUÉS del rol, que es el orden en que se decide: primero
          la plantilla, después los ajustes. Y no se enseña para un cliente: un
          laboratorio no entra a ningún módulo interno, así que ocho renglones en
          «Sin acceso» solo servirían para sugerir que se le puede dar uno.
        */}
        {role !== "client" && (
          <PermisosMatriz rol={role} ajustes={user.permisos} />
        )}

        {/* Vínculo con el CRM: solo tiene sentido para laboratorios. */}
        {role === "client" && (
          <div className="rounded-xl border border-border bg-secondary/30 p-4">
            <Label htmlFor="crmOrganizationId">Organización del CRM</Label>
            <select
              id="crmOrganizationId"
              name="crmOrganizationId"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              className={selectCls}
            >
              <option value="">— Sin vincular —</option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Link2 className="mt-0.5 size-3.5 shrink-0" />
              Al vincularla, la ficha comercial de esa organización mostrará los
              contratos, equipos y tickets de esta cuenta, y podrás generar
              contratos desde sus negocios ganados.
            </p>
          </div>
        )}

        {isSelf && (
          <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
            Esta es tu propia cuenta: no puedes quitarte el rol de administrador
            ni desactivarte.
          </p>
        )}

        <ErrorMsg error={state.error} />
        {state.ok && (
          <p className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="size-4" /> Cambios guardados.
          </p>
        )}

        <div className="flex justify-end">
          <Button type="submit" variant="accent" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Guardar cambios
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function ResetPasswordForm({ userId, email }: { userId: string; email: string }) {
  const [state, action, pending] = useActionState(resetUserPassword, initial);
  const [password, setPassword] = useState("");
  const [copied, setCopied] = useState(false);

  return (
    <Card className="p-6 sm:p-8">
      <h2 className="flex items-center gap-2 font-semibold">
        <KeyRound className="size-4 text-primary" /> Restablecer contraseña
      </h2>
      {/*
        SON DOS PASOS Y ANTES NO SE DECÍA.

        «Genera una nueva contraseña y compártela con el usuario» describe
        generar y compartir, y se salta justo el paso del medio: guardarla. Con
        «Generar» pegado al campo y el botón de guardar en la esquina y con
        estilo secundario, la lectura natural era que generar YA hacía el
        trabajo — se copiaba la contraseña, se mandaba por mensaje y la persona
        no podía entrar, porque nunca se guardó nada.

        Ahora los pasos van numerados en el texto y el botón que guarda es el
        primario. Lo que hace `Generar` está dicho: rellena el campo.
      */}
      <p className="mt-1 text-sm text-muted-foreground">
        Son dos pasos: <strong className="text-foreground">1)</strong> escribe una
        contraseña o pulsa «Generar», que solo rellena el campo, y{" "}
        <strong className="text-foreground">2)</strong> pulsa «Guardar contraseña».
        Hasta que no la guardes, la cuenta sigue con la anterior.
      </p>

      <form action={action} className="mt-4 grid gap-3">
        <input type="hidden" name="id" value={userId} />
        <div className="flex gap-2">
          <Input
            name="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Nueva contraseña (mín. 8)"
            autoComplete="new-password"
          />
          <Button type="button" variant="outline" onClick={() => setPassword(randomPassword())}>
            Generar
          </Button>
        </div>

        <ErrorMsg error={state.error} />
        {state.ok && (
          /*
            La confirmación DICE que se guardó, con palabras.

            Antes era un renglón verde con «correo / contraseña» y un icono, sin
            una sola frase: quien lo miraba veía dos datos y ninguna respuesta a
            la única pregunta que tenía, que era si había quedado guardada. Está
            comprobado que la acción guarda —el hash cambia y la contraseña
            nueva abre sesión—; lo que faltaba era decirlo.

            Y el aviso de que no se vuelve a ver: lo que se guarda es el hash,
            así que salir de esta pantalla sin copiarla significa generar otra.
          */
          <div className="rounded-lg border border-success/30 bg-success/5 px-3 py-2.5 text-sm">
            <p className="flex items-center gap-2 font-medium text-success">
              <CheckCircle2 className="size-4 shrink-0" />
              Contraseña guardada. Ya puede entrar con ella.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs">{email} / {password}</span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(`${email} / ${password}`);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Copiar correo y contraseña"
              >
                <Copy className="size-4" />
              </button>
              {copied && <span className="text-xs text-success">¡copiado!</span>}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Cópiala ahora: se guarda cifrada y no se puede volver a mostrar.
            </p>
          </div>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={pending || password.length < 8}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
            Guardar contraseña
          </Button>
        </div>
      </form>
    </Card>
  );
}
