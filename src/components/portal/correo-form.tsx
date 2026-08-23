"use client";

import { useActionState } from "react";
import { Mail, Loader2, CheckCircle2, Send, AlertTriangle } from "lucide-react";
import {
  guardarCorreoAction,
  probarCorreoAction,
  type CorreoState,
} from "@/lib/actions/correo";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * El buzón de salida de la empresa, configurado por la empresa.
 *
 * ── POR QUÉ ESTA PANTALLA EXISTE ───────────────────────────────────────────
 *
 * La otra vía —que cada cliente publique registros DKIM en su DNS— funciona y
 * cuesta una conversación sobre DNS con alguien que no sabe qué es un DNS, en
 * cada alta y para siempre. Aquí escribe el correo y la contraseña de un buzón
 * que YA tiene: el aviso sale de su servidor, lo firma su proveedor —SPF y DKIM
 * ya correctos sin tocar nada—, y le queda en Enviados.
 *
 * ── LA ADVERTENCIA NO ES DECORACIÓN ────────────────────────────────────────
 *
 * Gmail quitó el acceso con la contraseña normal en mayo de 2022, y Microsoft
 * lleva desde entonces apagando la autenticación básica de SMTP en Exchange
 * Online. Es decir: en los dos proveedores más comunes, «tu correo y tu
 * contraseña» NO funciona — hace falta una contraseña de aplicación.
 *
 * Sin decirlo aquí, el guion es siempre el mismo: la persona escribe su
 * contraseña de verdad, el servidor la rechaza, y concluye que el sistema está
 * roto. La advertencia va ANTES de los campos por eso, y no al pie.
 */
export function CorreoForm({
  configurado,
  host,
  port,
  user,
  from,
  fromName,
  replyTo,
  comprobado,
}: {
  configurado: boolean;
  host: string;
  port: number;
  user: string;
  from: string;
  fromName: string;
  replyTo: string;
  comprobado: Date | null;
}) {
  const inicial: CorreoState = { ok: false };
  const [guardado, guardar, guardando] = useActionState(guardarCorreoAction, inicial);
  const [prueba, probar, probando] = useActionState(probarCorreoAction, inicial);

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2">
        <Mail className="size-5 text-primary" />
        <h2 className="font-semibold">Correo de salida</h2>
        {configurado && comprobado && (
          <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs text-success ring-1 ring-success/25">
            <CheckCircle2 className="size-3" /> conectado
          </span>
        )}
      </div>

      <p className="mt-2 text-sm text-muted-foreground">
        Conecta el buzón de tu empresa y los avisos de tickets saldrán desde él.
        Si no lo configuras, salen desde Astraion con el nombre de tu empresa.
      </p>

      <div className="mt-4 flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/5 p-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="text-sm">
          <p className="font-medium">Con Gmail y Microsoft 365 no sirve tu contraseña normal.</p>
          <p className="mt-1 text-muted-foreground">
            Los dos dejaron de aceptarla. Necesitas una{" "}
            <span className="font-medium text-foreground">contraseña de aplicación</span>: en
            Gmail se genera desde tu cuenta con la verificación en dos pasos activada; en
            Microsoft 365, tu administrador tiene que habilitar «SMTP AUTH» para el buzón.
          </p>
        </div>
      </div>

      <form action={guardar} className="mt-5 grid gap-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
          <div>
            <Label htmlFor="host">Servidor de salida</Label>
            <Input
              id="host"
              name="host"
              defaultValue={host}
              placeholder="smtp.gmail.com"
              autoComplete="off"
            />
            {/* Dejarlo vacío apaga el buzón propio: se dice, en vez de que
                alguien lo descubra borrando el campo por error. */}
            <p className="mt-1 text-xs text-muted-foreground">
              Vacío = desconectar y volver a enviar desde Astraion.
            </p>
          </div>
          <div>
            <Label htmlFor="port">Puerto</Label>
            <Input id="port" name="port" type="number" defaultValue={port || 587} />
            <p className="mt-1 text-xs text-muted-foreground">587, o 465 con SSL.</p>
          </div>
        </div>

        <div>
          <Label htmlFor="user">Cuenta</Label>
          <Input
            id="user"
            name="user"
            type="email"
            defaultValue={user}
            placeholder="soporte@tuempresa.com"
            autoComplete="off"
          />
        </div>

        <div>
          <Label htmlFor="password">Contraseña</Label>
          <Input
            id="password"
            name="password"
            type="password"
            // Nunca se rellena con la guardada: no se devuelve a la interfaz
            // en ningún caso. Ver `lib/actions/correo`.
            placeholder={configurado ? "•••••••• (guardada — déjalo vacío para conservarla)" : ""}
            autoComplete="new-password"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Se guarda cifrada y no vuelve a mostrarse. Para cambiarla, escribe una nueva.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="fromName">Nombre del remitente</Label>
            <Input id="fromName" name="fromName" defaultValue={fromName} placeholder="Soporte" />
          </div>
          <div>
            <Label htmlFor="replyTo">Responder a</Label>
            <Input
              id="replyTo"
              name="replyTo"
              type="email"
              defaultValue={replyTo}
              placeholder="soporte@tuempresa.com"
            />
          </div>
        </div>

        <input type="hidden" name="from" value={from || user} />

        {guardado.error && <p className="text-sm text-destructive">{guardado.error}</p>}
        {guardado.ok && guardado.message && (
          <p className="text-sm text-success">{guardado.message}</p>
        )}

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={guardando}>
            {guardando ? <Loader2 className="size-4 animate-spin" /> : null}
            {guardando ? "Comprobando…" : "Guardar y comprobar"}
          </Button>
        </div>
      </form>

      {/* La prueba va en su propio formulario: no debe arrastrar los campos de
          arriba ni guardar nada. */}
      <form action={probar} className="mt-4 border-t border-border pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="outline" size="sm" disabled={probando}>
            {probando ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Enviarme una prueba
          </Button>
          {prueba.error && <span className="text-sm text-destructive">{prueba.error}</span>}
          {prueba.ok && prueba.message && (
            <span className="text-sm text-success">{prueba.message}</span>
          )}
        </div>
      </form>
    </Card>
  );
}
