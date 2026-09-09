import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import { Link } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import { PrintButton } from "@/components/portal/print-button";
import type { Membrete } from "@/lib/documentos";

/**
 * LA HOJA. Todo documento imprimible del portal se dibuja aquí dentro.
 *
 * ── QUÉ PONE ESTA CAPA Y QUÉ PONE CADA MÓDULO ──────────────────────────────
 *
 * Esta capa: el membrete —logo, nombre, lema—, el título y el folio, la hoja
 * con su ancho y sus márgenes de impresión, la barra de «volver / imprimir»
 * que no se imprime, y el pie con los datos de contacto.
 *
 * Cada módulo: su cuerpo. Nada más.
 *
 * Ese reparto es toda la razón de que exista. Antes el reporte de servicio
 * llevaba su propio membrete escrito a mano; el segundo documento —viáticos—
 * habría sido una copia, y a la tercera nadie se acuerda de actualizar las
 * tres. Aquí no pueden divergir porque solo hay una.
 *
 * ── LAS CLASES DE IMPRESIÓN NO SE TOCAN DESDE FUERA ────────────────────────
 *
 * `print-sheet`, `no-print` y `print-avoid-break` viven en `globals.css` y las
 * pone esta capa. Un módulo que quiera evitar un corte de página usa
 * `<SeccionDoc>`; no tiene por qué conocer el nombre de la clase, que es lo que
 * hace que cambiarla no sea una cacería.
 *
 * ── NO ES UN COMPONENTE DE CLIENTE ─────────────────────────────────────────
 *
 * Se renderiza en el servidor, como las páginas que lo usan. Lo único
 * interactivo es el botón de imprimir, que ya era cliente por su cuenta.
 */
export function Documento({
  membrete,
  titulo,
  folio,
  volverA,
  volverLabel = "Volver",
  emitido,
  children,
}: {
  membrete: Membrete;
  /** «Reporte de servicio», «Comprobación de viáticos». */
  titulo: string;
  /** El folio del documento: EVO-000123, EVO-V-000045. */
  folio: string;
  volverA: string;
  volverLabel?: string;
  /** Fecha de emisión ya formateada por quien llama, que sabe su locale. */
  emitido: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-6 flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href={volverA}>
            <ArrowLeft className="size-4" /> {volverLabel}
          </Link>
        </Button>
        <PrintButton label="Imprimir / Guardar PDF" />
      </div>

      <div className="print-sheet mx-auto max-w-4xl rounded-xl border border-zinc-200 bg-white p-8 text-zinc-900 shadow-sm sm:p-12">
        <header className="flex items-start justify-between gap-6 border-b-2 border-zinc-900 pb-6">
          <div>
            <div className="flex items-center gap-2.5">
              {membrete.logo ? (
                /*
                  `unoptimized`: el logo va a un documento que se imprime y que
                  se abre una vez. Pasarlo por el optimizador es trabajo de
                  servidor para una imagen que no se vuelve a pedir, y encima
                  puede recomprimirla justo cuando más nítida hace falta.
                */
                <Image
                  src={membrete.logo}
                  alt={membrete.nombre}
                  width={160}
                  height={44}
                  className="h-10 w-auto object-contain"
                  unoptimized
                />
              ) : (
                // Monograma, y NUNCA el logo de otra empresa. Misma regla que
                // sostiene `TenantMark` en la barra lateral.
                <span className="flex size-9 items-center justify-center rounded-lg bg-zinc-900 text-sm font-bold text-white">
                  {membrete.nombre.trim().charAt(0).toUpperCase()}
                </span>
              )}
              <span className="text-xl font-bold tracking-tight">
                {membrete.nombre}
              </span>
            </div>
            {membrete.tagline ? (
              <p className="mt-2 text-[13px] text-zinc-500">{membrete.tagline}</p>
            ) : null}
          </div>
          <div className="text-right">
            <h1 className="text-lg font-bold uppercase tracking-wide">{titulo}</h1>
            <p className="mt-1 font-mono text-sm text-zinc-700">{folio}</p>
            <p className="text-[13px] text-zinc-500">Emitido: {emitido}</p>
          </div>
        </header>

        {children}

        {/*
          Si no hay ningún dato de contacto, el pie entero desaparece en vez de
          dejar una raya vacía cerrando la hoja. Lo que falta se omite: no se
          hereda de nadie ni se rellena con un ejemplo.
        */}
        {membrete.pie.length > 0 ? (
          <footer className="mt-10 border-t border-zinc-200 pt-4 text-center text-[11px] text-zinc-400">
            {membrete.pie.join(" · ")}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Una sección del cuerpo que no se debe partir entre dos páginas.
 *
 * Existe para que los módulos no tengan que conocer `print-avoid-break`: el día
 * que esa clase cambie de nombre, cambia aquí y no en cada documento.
 */
export function SeccionDoc({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <section className={`print-avoid-break ${className}`}>{children}</section>;
}

/**
 * Un dato con su rótulo, en dos columnas.
 *
 * Sale del reporte de servicio, donde estaba como una función local. Lo usan
 * los dos documentos y por eso vive aquí: dos definiciones del mismo renglón
 * acaban con dos tipografías distintas en dos papeles de la misma empresa.
 */
export function CampoDoc({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-zinc-100 py-1.5 text-sm last:border-0">
      <span className="text-zinc-500">{k}</span>
      <span className="text-right font-medium">{v}</span>
    </div>
  );
}

/**
 * EL BLOQUE DE FIRMAS.
 *
 * Dos o más rúbricas al pie, cada una con quién firma y en calidad de qué.
 * Genérico a propósito: el reporte de servicio firma técnico y cliente, el de
 * viáticos firma quien viajó y quien autorizó, y el día que haya un tercer
 * documento firmará a otros — pero las tres rayas tienen que verse iguales,
 * porque es el mismo papel de la misma empresa.
 *
 * El nombre puede faltar y la raya se dibuja igual: un documento se imprime
 * también para firmarlo A MANO, y ahí el hueco es el punto.
 */
export function FirmasDoc({
  firmas,
}: {
  firmas: Array<{ nombre: string | null; calidad: string }>;
}) {
  return (
    <SeccionDoc className="grid gap-10 pt-14 sm:grid-cols-2">
      {firmas.map((f, i) => (
        <div key={i} className="text-center">
          <div className="mx-auto border-t border-zinc-400 pt-2 text-sm">
            <p className="font-medium">{f.nombre ?? " "}</p>
            <p className="text-zinc-500">{f.calidad}</p>
          </div>
        </div>
      ))}
    </SeccionDoc>
  );
}
