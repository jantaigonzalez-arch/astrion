"use client";

import { useActionState, useState } from "react";
import Image from "next/image";
import { FileText, Loader2, Save, Trash2, Upload } from "lucide-react";
import { updateDocumentBranding, type BrandState } from "@/lib/actions/brand";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: BrandState = { ok: false };

export type Membrete = {
  /** El nombre legal de la empresa. Es el respaldo del nombre corto. */
  name: string;
  brandName: string | null;
  /** El de la barra lateral. Respaldo del de documentos. */
  logoUrl: string | null;
  documentLogoUrl: string | null;
  tagline: string | null;
  contactAddress: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
};

/**
 * EL MEMBRETE DE LOS DOCUMENTOS IMPRESOS.
 *
 * ── LA VISTA PREVIA VA SOBRE BLANCO, Y ESO ES LA MITAD DE LA PANTALLA ──────
 *
 * Porque el problema que resuelve subir un logo para papel es justamente que el
 * archivo que se ve bien en la barra lateral —clara sobre fondo oscuro— sale
 * invisible impreso. Una vista previa sobre el fondo de la aplicación mentiría
 * exactamente en lo único que hay que comprobar. Así que esto se pinta con el
 * mismo blanco, el mismo negro y la misma línea divisoria que el reporte.
 *
 * ── LO QUE FALTA DESAPARECE, NO SE RELLENA ────────────────────────────────
 *
 * Si no hay teléfono, la vista previa no enseña un «teléfono» de muestra: no
 * enseña nada, igual que el documento. Un formulario que rellena huecos con
 * ejemplos hace que se guarde el ejemplo.
 */
export function DocumentoForm({ membrete }: { membrete: Membrete }) {
  const [state, action, pending] = useActionState(updateDocumentBranding, initial);

  const [preview, setPreview] = useState<string | null>(null);
  const [quitado, setQuitado] = useState(false);
  const [tagline, setTagline] = useState(membrete.tagline ?? "");
  const [direccion, setDireccion] = useState(membrete.contactAddress ?? "");
  const [telefono, setTelefono] = useState(membrete.contactPhone ?? "");
  const [correo, setCorreo] = useState(membrete.contactEmail ?? "");

  const nombre = membrete.brandName || membrete.name;

  /*
    LA CASCADA, tal cual la aplica el reporte: logo de documento → logo de
    marca → monograma. Se repite aquí a propósito y no se importa del servidor,
    porque lo que esta pantalla promete es «así va a salir»: si las dos reglas
    se separaran, la vista previa sería una segunda opinión.
  */
  const logo = quitado
    ? membrete.logoUrl
    : (preview ?? membrete.documentLogoUrl ?? membrete.logoUrl);

  const pie = [direccion.trim(), telefono.trim(), correo.trim()].filter(Boolean);

  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <FileText className="size-4 text-primary" />
        Membrete de documentos
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Lo que encabeza y cierra el reporte de servicio que se imprime y se le
        entrega al cliente. Sin logo propio se usa el de la marca; sin datos de
        contacto, esas líneas no se imprimen.
      </p>

      {/* ── Vista previa: el papel, no la aplicación ── */}
      <div className="mt-4 rounded-lg border border-border bg-zinc-100 p-4 dark:bg-zinc-800">
        <p className="mb-3 text-[11px] uppercase tracking-wider text-muted-foreground">
          Así se va a imprimir
        </p>
        <div className="rounded bg-white p-5 text-zinc-900">
          <div className="flex items-start justify-between gap-6 border-b-2 border-zinc-900 pb-4">
            <div>
              <div className="flex items-center gap-2.5">
                {logo ? (
                  <Image
                    src={logo}
                    alt=""
                    width={140}
                    height={40}
                    className="h-9 w-auto object-contain"
                    unoptimized
                  />
                ) : (
                  // El monograma: el último escalón de la cascada. Se dibuja
                  // igual que en el documento para que nadie descubra en el
                  // papel que su empresa sale como una letra en un cuadrado.
                  <span className="flex size-9 items-center justify-center rounded-lg bg-zinc-900 text-sm font-bold text-white">
                    {nombre.trim().charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="text-lg font-bold tracking-tight">{nombre}</span>
              </div>
              {tagline.trim() ? (
                <p className="mt-1.5 text-[12px] text-zinc-500">{tagline.trim()}</p>
              ) : null}
            </div>
            <div className="text-right">
              <p className="text-sm font-bold uppercase tracking-wide">
                Reporte de servicio
              </p>
              <p className="mt-0.5 font-mono text-xs text-zinc-700">EVO-000123</p>
            </div>
          </div>
          <p className="mt-4 border-t border-zinc-200 pt-3 text-center text-[10px] text-zinc-400">
            {pie.length > 0 ? pie.join(" · ") : "(sin datos de contacto en el pie)"}
          </p>
        </div>
      </div>

      <form action={action} className="mt-5 grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="documentLogo">Logo para documentos</Label>
          <Input
            id="documentLogo"
            name="documentLogo"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="file:mr-2 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs"
            onChange={(e) => {
              const f = e.target.files?.[0];
              setPreview(f ? URL.createObjectURL(f) : null);
              if (f) setQuitado(false);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Va sobre papel blanco: conviene una versión horizontal y oscura, no
            la de la barra lateral. Si no subes ninguno se usa el de la marca.
          </p>
          {membrete.documentLogoUrl && !quitado ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              {/*
                La casilla y no un botón que borra al pulsarlo: quitar el logo
                se confirma al GUARDAR, junto con lo demás. Un borrado inmediato
                no tiene deshacer y aquí no hace falta que lo tenga.
              */}
              <input
                type="checkbox"
                name="removeDocumentLogo"
                value="1"
                className="size-3.5 rounded border-input"
                onChange={(e) => setQuitado(e.target.checked)}
              />
              <Trash2 className="size-3.5" />
              Quitar el logo de documentos y volver al de la marca
            </label>
          ) : null}
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="tagline">Lema</Label>
          <Input
            id="tagline"
            name="tagline"
            maxLength={120}
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="Ej. Automatización analítica y cromatografía"
          />
          <p className="text-xs text-muted-foreground">
            Una línea bajo el nombre. Opcional.
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="contactAddress">Dirección</Label>
          <Input
            id="contactAddress"
            name="contactAddress"
            maxLength={200}
            value={direccion}
            onChange={(e) => setDireccion(e.target.value)}
            placeholder="Calle y número, colonia, ciudad"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="contactPhone">Teléfono</Label>
            <Input
              id="contactPhone"
              name="contactPhone"
              maxLength={40}
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              placeholder="(+52) 55 0000 0000"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="contactEmail">Correo de contacto</Label>
            <Input
              id="contactEmail"
              name="contactEmail"
              type="email"
              maxLength={160}
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
              placeholder="servicio@tuempresa.com"
            />
            {/*
              Se dice la diferencia aquí y no en la documentación: es el error
              que se comete una sola vez y se descubre meses después, cuando
              alguien pregunta por qué nadie contestó.
            */}
            <p className="text-xs text-muted-foreground">
              A dónde escribe quien recibe el reporte. No es el remitente de los
              avisos: ese se configura en Correo.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          {state.ok && state.message ? (
            <span className="text-sm text-success">{state.message}</span>
          ) : null}
          {state.error ? (
            <span className="text-sm text-destructive">{state.error}</span>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : preview ? (
              <Upload className="size-4" />
            ) : (
              <Save className="size-4" />
            )}
            Guardar
          </Button>
        </div>
      </form>
    </Card>
  );
}
