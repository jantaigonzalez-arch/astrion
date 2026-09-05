"use client";

import { useActionState, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Loader2,
  Upload,
} from "lucide-react";
import {
  commitPayableImport,
  previewPayableImport,
  type ImportState,
} from "@/lib/actions/payables";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const initial: ImportState = { ok: false };

type Kind = "charges_csv" | "credits_csv" | "charges_cfdi";

const TIPOS: Array<{
  kind: Kind;
  label: string;
  hint: string;
  accept: string;
  multiple: boolean;
  Icon: typeof FileText;
}> = [
  {
    kind: "charges_csv",
    label: "Cargos (CSV)",
    hint: "Facturas del proveedor. Crean la deuda.",
    accept: ".csv,text/csv",
    multiple: false,
    Icon: FileSpreadsheet,
  },
  {
    kind: "credits_csv",
    label: "Abonos (CSV)",
    hint: "Pagos y notas de crédito. Bajan la deuda.",
    accept: ".csv,text/csv",
    multiple: false,
    Icon: FileSpreadsheet,
  },
  {
    kind: "charges_cfdi",
    label: "Cargos (XML de CFDI)",
    hint: "Arrastra los XML. Los importes salen del archivo.",
    accept: ".xml,text/xml,application/xml",
    multiple: true,
    Icon: FileText,
  },
];

/**
 * Importación masiva de cuentas por pagar.
 *
 * Dos pasos SIEMPRE: previsualizar y luego confirmar. No hay atajo para
 * importar directo, y es a propósito — un lote de cien facturas mal resueltas
 * cuesta muchísimo más deshacer que revisar. La previsualización no es una
 * simulación: el servidor ejecuta el lote entero y lo revierte, así que lo que
 * aparece aquí es literalmente lo que va a quedar.
 */
export function ImportPayables({ plantillas }: { plantillas: Record<string, string> }) {
  const [kind, setKind] = useState<Kind>("charges_csv");
  const [preview, previewAction, previewing] = useActionState(
    previewPayableImport,
    initial,
  );
  const [commit, commitAction, committing] = useActionState(
    commitPayableImport,
    initial,
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);

  const tipo = TIPOS.find((t) => t.kind === kind)!;
  const estado = commit.phase === "commit" ? commit : preview;
  const yaImportado = commit.phase === "commit" && commit.ok;
  const puedeConfirmar =
    preview.ok && preview.phase === "preview" && (preview.outcome?.okCount ?? 0) > 0;

  return (
    <div className="space-y-6">
      {/* Paso 1: qué se importa y desde qué archivo */}
      <Card className="p-5">
        <h2 className="mb-4 flex items-center gap-2 font-semibold">
          <Upload className="size-4 text-primary" /> Elige qué importar
        </h2>

        <div className="grid gap-3 sm:grid-cols-3">
          {TIPOS.map((t) => (
            <button
              key={t.kind}
              type="button"
              onClick={() => {
                setKind(t.kind);
                setFiles([]);
                if (fileRef.current) fileRef.current.value = "";
              }}
              className={cn(
                "rounded-md border p-3 text-left transition",
                kind === t.kind
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-secondary/40",
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <t.Icon className="size-4" /> {t.label}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">{t.hint}</span>
            </button>
          ))}
        </div>

        {plantillas[kind] && (
          <p className="mt-4 text-xs text-muted-foreground">
            ¿No sabes qué columnas lleva?{" "}
            <a
              href={plantillas[kind]}
              download
              className="font-medium text-primary hover:underline"
            >
              Descarga la plantilla
            </a>{" "}
            y llénala con tus datos.
          </p>
        )}

        <form action={previewAction} className="mt-5 space-y-4">
          <input type="hidden" name="kind" value={kind} />
          <input
            ref={fileRef}
            type="file"
            name="files"
            accept={tipo.accept}
            multiple={tipo.multiple}
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-4 file:py-2 file:text-sm file:font-medium"
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={previewing || !files.length}>
              {previewing ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Revisando…
                </>
              ) : (
                "Previsualizar"
              )}
            </Button>
            {files.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {files.length === 1
                  ? files[0].name
                  : `${files.length} archivos seleccionados`}
              </span>
            )}
          </div>
        </form>

        {estado.error && (
          <p className="mt-3 text-sm text-destructive">{estado.error}</p>
        )}
      </Card>

      {/* Paso 2: qué va a pasar */}
      {estado.outcome && (
        <Card className="overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h2 className="font-semibold">
                {yaImportado ? "Resultado de la importación" : "Así quedaría"}
              </h2>
              <p className="text-sm text-muted-foreground">{estado.message}</p>
            </div>

            {puedeConfirmar && !yaImportado && (
              // El archivo se vuelve a mandar: una Server Action no guarda el
              // que se subió en la previsualización, y reusar el mismo input
              // garantiza que se confirme exactamente lo que se revisó.
              <form action={commitAction}>
                <input type="hidden" name="kind" value={kind} />
                <ReenviarArchivos files={files} />
                <Button type="submit" variant="accent" disabled={committing}>
                  {committing ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Importando…
                    </>
                  ) : (
                    `Confirmar ${estado.outcome.okCount} ${
                      estado.outcome.okCount === 1 ? "fila" : "filas"
                    }`
                  )}
                </Button>
              </form>
            )}
          </div>

          <div className="grid gap-px bg-border sm:grid-cols-2">
            <Resumen
              tono="ok"
              n={estado.outcome.okCount}
              texto={yaImportado ? "importadas" : "se importarían"}
            />
            <Resumen
              tono="mal"
              n={estado.outcome.errorCount}
              texto="con problema"
            />
          </div>

          {!yaImportado && (
            <p className="border-t border-border bg-secondary/30 px-5 py-3 text-xs text-muted-foreground">
              Todavía no se ha guardado nada. Corrige lo que haga falta en el
              archivo y vuelve a previsualizar, o confirma para escribir solo las
              filas correctas.
            </p>
          )}

          <div className="max-h-[26rem] overflow-auto">
            {/* Se desplaza DENTRO de su caja: una tabla ancha nunca empuja la página. */}
            <div className="tabla-caja">
              <table className="tabla-erp w-full text-sm">
                <thead className="sticky top-0 border-b border-border bg-secondary/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Línea</th>
                    <th className="px-4 py-2 font-medium">Fila</th>
                    <th className="px-4 py-2 font-medium">Resultado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {estado.outcome.results.map((r) => (
                    <tr
                      key={`${r.line}-${r.label}`}
                      className={r.ok ? "" : "bg-destructive/5"}
                    >
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                        {r.line}
                      </td>
                      <td className="px-4 py-2">{r.label}</td>
                      <td className="px-4 py-2">
                        {r.ok ? (
                          <span className="inline-flex items-center gap-1.5 text-success">
                            <CheckCircle2 className="size-3.5" />
                            <span className="font-mono text-xs">{r.reference}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-start gap-1.5 text-destructive">
                            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                            <span className="text-xs">{r.reason}</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

/**
 * Vuelve a colgar los archivos ya elegidos en el formulario de confirmación.
 *
 * Un `<input type="file">` no acepta un `value`, así que se rellena por
 * `DataTransfer` — la única vía para poner archivos en un input mediante
 * JavaScript.
 */
function ReenviarArchivos({ files }: { files: File[] }) {
  return (
    <input
      type="file"
      name="files"
      multiple
      className="hidden"
      ref={(el) => {
        if (!el || !files.length) return;
        const dt = new DataTransfer();
        for (const f of files) dt.items.add(f);
        el.files = dt.files;
      }}
    />
  );
}

function Resumen({
  tono,
  n,
  texto,
}: {
  tono: "ok" | "mal";
  n: number;
  texto: string;
}) {
  return (
    <div className="bg-card px-5 py-4">
      <p
        className={cn(
          "text-2xl font-semibold tabular-nums",
          tono === "ok" && n > 0 && "text-success",
          tono === "mal" && n > 0 && "text-destructive",
        )}
      >
        {n}
      </p>
      <p className="text-xs text-muted-foreground">{texto}</p>
    </div>
  );
}
