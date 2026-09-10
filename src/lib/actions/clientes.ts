"use server";

import { auth } from "@/lib/auth";
import { tenantDb, puedeEn } from "@/lib/tenancy/context";
import { revalidateTenant } from "@/lib/revalidate";
import { clienteFiscal, clienteValidacionSat, clienteValidacionSatLog } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getCatalogosSat, precargarCp } from "@/lib/data/sat";
import {
  validarExpediente,
  hashExpediente,
  type Incidencia,
  type RolFiscal,
} from "@/lib/domain/cliente";

/**
 * GUARDAR EL EXPEDIENTE FISCAL DE UN CLIENTE.
 *
 * ── POR QUÉ ES UNA ACCIÓN APARTE Y NO PARTE DE «GUARDAR ORGANIZACIÓN» ──────
 *
 * Por tres razones, y ninguna es de organización del código:
 *
 * 1. EL PERMISO ES OTRO. Ajustar un teléfono o un responsable es
 *    `clientes:editar`; cambiar el RFC con el que se factura es
 *    `clientes:administrar`. Una sola acción obligaría a exigir el nivel alto
 *    para todo o el bajo para todo, y las dos opciones son malas.
 *
 * 2. UN FALLO NO DEBE ARRASTRAR AL OTRO. Que el régimen fiscal esté mal no es
 *    motivo para no guardar el teléfono que alguien acaba de corregir, ni al
 *    revés. Juntas, cualquier error deja sin guardar todo lo demás.
 *
 * 3. LOS ERRORES TIENEN OTRA FORMA. Aquí se contesta con incidencias POR CAMPO
 *    y con los códigos del SAT (`CFDI40158`…), porque un mensaje que se puede
 *    pegar en un buscador y llegar a la documentación oficial es accionable y
 *    «datos inválidos» no lo es.
 *
 * Es el mismo principio que separa `cliente_fiscal` de `cliente_comercial` en
 * la base: lo fiscal y lo comercial tienen dueños, ritmos y consecuencias
 * distintas.
 */
export type ExpedienteState = {
  ok: boolean;
  /** Mensaje general, para lo que no pertenece a ningún campo. */
  error?: string;
  mensaje?: string;
  /** Lo que impidió guardar, campo por campo. */
  errores?: Incidencia[];
  /** Lo que se guardó pero no se pudo comprobar. Ver la nota de abajo. */
  advertencias?: Incidencia[];
};

const texto = (f: FormData, k: string) => ((f.get(k) as string) || "").trim() || null;

export async function guardarExpedienteFiscal(
  _prev: ExpedienteState,
  formData: FormData,
): Promise<ExpedienteState> {
  const session = await auth();
  if (!session?.user || !(await puedeEn("clientes", "administrar"))) {
    return { ok: false, error: "Solo un administrador puede cambiar los datos fiscales." };
  }

  const organizationId = texto(formData, "organizationId");
  if (!organizationId) return { ok: false, error: "Falta la organización." };

  /*
    Los catálogos se leen ANTES de validar, y el código postal se precarga.

    `validarExpediente` es puro y no toca la base a propósito: así las reglas
    fiscales se prueban sin Postgres. El precio es que quien llama tiene que
    traerle lo que va a necesitar, y ese precio se paga aquí, a la vista, en vez
    de esconder una consulta dentro de algo que se anuncia como puro.
  */
  const cpFiscal = texto(formData, "cpFiscal") ?? "";
  const catalogos = await precargarCp(await getCatalogosSat(), cpFiscal);

  const entrada = {
    rolFiscal: (texto(formData, "rolFiscal") ?? "normal") as RolFiscal,
    rfc: texto(formData, "rfc") ?? "",
    nombre: texto(formData, "nombreFiscal") ?? "",
    regimenFiscal: texto(formData, "regimenFiscal") ?? "",
    cpFiscal,
    paisResidencia: texto(formData, "paisResidencia"),
    numRegIdTrib: texto(formData, "numRegIdTrib"),
    curp: texto(formData, "curp"),
    usoCfdiDefault: texto(formData, "usoCfdiDefault"),
  };

  const r = validarExpediente(entrada, catalogos);
  if (!r.ok || !r.normalizado) {
    return { ok: false, errores: r.errores, advertencias: r.advertencias };
  }

  const n = r.normalizado;
  const huella = hashExpediente({
    rfc: n.rfc,
    nombreFiscal: n.nombreFiscal,
    cpFiscal: n.cpFiscal,
    regimenFiscal: n.regimenFiscal,
  });

  try {
    const db = await tenantDb();

    await db.transaction(async (tx) => {
      await tx
        .insert(clienteFiscal)
        .values({
          organizationId,
          rolFiscal: entrada.rolFiscal,
          personaTipo: n.personaTipo,
          rfc: n.rfc,
          nombreFiscal: n.nombreFiscal,
          nombreCapturado: n.nombreCapturado,
          curp: entrada.curp,
          regimenFiscal: n.regimenFiscal,
          cpFiscal: n.cpFiscal,
          paisResidencia: n.paisResidencia,
          numRegIdTrib: entrada.numRegIdTrib,
          usoCfdiDefault: entrada.usoCfdiDefault,
          actualizadoPor: session.user.id,
          actualizadoEn: new Date(),
        })
        .onConflictDoUpdate({
          target: clienteFiscal.organizationId,
          set: {
            rolFiscal: entrada.rolFiscal,
            personaTipo: n.personaTipo,
            rfc: n.rfc,
            nombreFiscal: n.nombreFiscal,
            nombreCapturado: n.nombreCapturado,
            curp: entrada.curp,
            regimenFiscal: n.regimenFiscal,
            cpFiscal: n.cpFiscal,
            paisResidencia: n.paisResidencia,
            numRegIdTrib: entrada.numRegIdTrib,
            usoCfdiDefault: entrada.usoCfdiDefault,
            actualizadoPor: session.user.id,
            actualizadoEn: new Date(),
          },
        });

      /*
        ── LA VALIDACIÓN CADUCA CON EL DATO ────────────────────────────────

        Si alguno de los cuatro campos que el SAT contrasta cambió, la huella
        deja de cuadrar y el veredicto anterior deja de valer. Se vuelve a
        `no_validado` en vez de conservarse, porque un «válido» de hace tres
        meses sobre un nombre editado ayer da confianza sin respaldo — que es
        peor que no haber validado nunca.

        El veredicto que se descarta NO se pierde: antes de pisarlo se copia a
        la bitácora, que es append-only. La pregunta «¿desde cuándo este cliente
        dejó de estar validado?» tiene que tener respuesta.
      */
      const [previo] = await tx
        .select()
        .from(clienteValidacionSat)
        .where(eq(clienteValidacionSat.organizationId, organizationId))
        .limit(1);

      if (previo && previo.hashDatos !== huella) {
        if (previo.resultado !== "no_validado") {
          await tx.insert(clienteValidacionSatLog).values({
            organizationId,
            resultado: previo.resultado,
            lista69b: previo.lista69b,
            validadoEn: previo.validadoEn ?? new Date(),
            origen: previo.origen,
            payloadCrudo: previo.payloadCrudo,
            hashDatos: previo.hashDatos,
          });
        }
        await tx
          .update(clienteValidacionSat)
          .set({
            resultado: "no_validado",
            validadoEn: null,
            origen: null,
            payloadCrudo: null,
            hashDatos: huella,
          })
          .where(eq(clienteValidacionSat.organizationId, organizationId));
      } else if (!previo) {
        await tx.insert(clienteValidacionSat).values({
          organizationId,
          resultado: "no_validado",
          hashDatos: huella,
        });
      }
    });

    revalidateTenant();

    /*
      Se devuelven las ADVERTENCIAS junto al éxito, y no se las traga.

      Guardar salió bien; prometer que la factura va a salir, no. Mientras el
      nombre no se haya contrastado contra la Constancia —o mientras falte un
      catálogo del SAT— hay cosas que este sistema no puede saber, y decirlo es
      la diferencia entre un aviso ahora y un rechazo del PAC después.
    */
    return {
      ok: true,
      mensaje:
        n.nombreFiscal !== n.nombreCapturado.trim().toUpperCase()
          ? `Guardado. Se timbrará como «${n.nombreFiscal}».`
          : "Datos fiscales guardados.",
      advertencias: r.advertencias,
    };
  } catch (e) {
    console.error("[clientes] guardarExpedienteFiscal:", e);
    return { ok: false, error: "No se pudo guardar el expediente fiscal." };
  }
}
