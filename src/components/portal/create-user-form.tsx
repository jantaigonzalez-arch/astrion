"use client";

import { ASSIGNABLE_ROLES, ROLE_LABELS } from "@/lib/roles";

import { useActionState, useState } from "react";
import { Boxes, CheckCircle2, Copy, Loader2, RefreshCw, UserPlus } from "lucide-react";
import { createUser, type CreateUserState } from "@/lib/actions/users";
import { Link } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: CreateUserState = { ok: false };
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

export function CreateUserForm() {
  const [state, action, pending] = useActionState(createUser, initial);
  const [password, setPassword] = useState("");
  const [copied, setCopied] = useState(false);

  if (state.ok) {
    const creds = `${state.createdEmail} / ${password}`;
    // La cuenta ya existía en la plataforma: se le dio acceso a esta empresa
    // conservando su contraseña. Enseñar la que se escribió en el formulario
    // sería entregar unas credenciales que no funcionan.
    const linked = state.linkedExisting;
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <CheckCircle2 className="size-12 text-success" />
        <div>
          <p className="font-medium">{linked ? "Acceso concedido" : "Cuenta creada"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {linked
              ? "Esa persona ya tenía cuenta en la plataforma. Ahora también pertenece a esta empresa y entra con la contraseña que ya usaba."
              : "Comparte estas credenciales con el laboratorio:"}
          </p>
        </div>
        {!linked && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/50 px-4 py-2.5 font-mono text-sm">
            <span>{creds}</span>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(creds);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Copiar"
            >
              <Copy className="size-4" />
            </button>
            {copied && <span className="text-xs text-success">¡copiado!</span>}
          </div>
        )}
        <div className="flex flex-wrap justify-center gap-2">
          {state.createdRole === "client" && state.createdId && (
            <Button asChild variant="accent">
              <Link href={`/admin/equipos/${state.createdId}`}>
                <Boxes className="size-4" /> Registrar equipos
              </Link>
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href="/admin/configuracion/usuarios">Ver usuarios</Link>
          </Button>
          <Button variant="ghost" onClick={() => location.reload()}>
            Crear otro
          </Button>
        </div>
        {state.createdRole === "client" && (
          <p className="max-w-sm text-xs text-muted-foreground">
            Siguiente paso: registra los equipos del laboratorio (equipo → módulos → submódulos, con número de serie y foto).
          </p>
        )}
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="name">Nombre del contacto</Label>
          <Input id="name" name="name" required placeholder="Ej. María López" />
        </div>
        <div>
          <Label htmlFor="company">Laboratorio / Empresa</Label>
          <Input id="company" name="company" placeholder="Ej. Lab Analítico SA" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="email">Correo (usuario de acceso)</Label>
          <Input id="email" name="email" type="email" required autoComplete="off" placeholder="contacto@lab.com" />
        </div>
        <div>
          <Label htmlFor="phone">Teléfono</Label>
          <Input id="phone" name="phone" placeholder="+52 55 0000 0000" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="role">Rol</Label>
          <select id="role" name="role" defaultValue="client" className={selectCls}>
            {/*
            LOS ROLES SALEN DE `ASSIGNABLE_ROLES`, NO ESCRITOS A MANO.

            Estaban los cuatro literales aquí dentro, y el día que nació el
            rol General el formulario no se enteró: se podía filtrar por él en
            el padrón y no se podía asignar a nadie. Una lista blanca copiada
            es una lista blanca que se queda vieja sin avisar, porque nada
            falla — simplemente falta una opción.
            */}
            {ASSIGNABLE_ROLES.map((r) => (
            <option key={r} value={r}>
            {ROLE_LABELS[r]}
            </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="password">Contraseña inicial</Label>
          <div className="flex gap-2">
            <Input
              id="password"
              name="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="mín. 8 caracteres"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              title="Generar contraseña"
              onClick={() => setPassword(randomPassword())}
            >
              <RefreshCw className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {state.error === "duplicate" && (
        <p className="text-sm text-destructive">
          Esa persona ya pertenece a esta empresa. Para cambiarle el rol, edítala
          desde el listado de usuarios.
        </p>
      )}
      {state.error === "invalid" && (
        <p className="text-sm text-destructive">Revisa los campos: correo válido y contraseña de 8+ caracteres.</p>
      )}
      {state.error === "auth" && (
        <p className="text-sm text-destructive">No autorizado. Solo un administrador puede crear cuentas.</p>
      )}
      {state.error === "server" && (
        <p className="text-sm text-destructive">Ocurrió un error. Intenta de nuevo.</p>
      )}

      <Button type="submit" variant="accent" size="lg" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
        Crear cuenta
      </Button>
    </form>
  );
}
