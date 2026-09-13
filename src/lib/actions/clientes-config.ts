"use server";

import { puedeEn, tenantDb } from "@/lib/tenancy/context";
import { revalidateTenant } from "@/lib/revalidate";
import { settings } from "@/lib/db/schema";
import { getCatalogosSat } from "@/lib/data/sat";
import { slaHorasValidas } from "@/lib/tickets";
import {
  POLITICAS_69B,
  PRUEBAS_DE_CLIENTE,
  type Politica69b,
  type PruebaDeCliente,
} from "@/lib/politica-clientes";

export type ClientesConfigState = { ok: boolean; message?: string; error?: string };

/**
 * LO QUE DECIDE LA EMPRESA SOBRE SUS CLIENTES (0038). Configuración → Clientes.
 *
 * Una sola acción para la política entera, como la de viáticos: se decide
 * junta y guardarla por perilla la dejaría a medias entre un clic y otro. La
 * guardia es `clientes: administrar` —quien administra los clientes, no quien
 * administra el sistema—. Aquí se sanea la forma; lo que cada ajuste decide lo
 * hacen cumplir `ES_CLIENTE`, `slaDueFrom` y `vetoLista69b`.
 */
export async function guardarPoliticaClientes(
  _prev: ClientesConfigState,
  formData: FormData,
): Promise<ClientesConfigState> {
  if (!(await puedeEn("clientes", "administrar"))) {
    return { ok: false, error: "Solo quien administra Clientes puede cambiar esta configuración." };
  }

  // El SLA general: entero de 1 a 720 horas, el mismo rango que un plazo pactado.
  const sla = Number(String(formData.get("slaHoras") ?? "").trim());
  if (!slaHorasValidas(sla)) {
    return { ok: false, error: "El SLA general va de 1 a 720 horas (treinta días)." };
  }

  /*
    El uso de CFDI por omisión. Vacío = sin sugerencia. Si los catálogos del SAT
    están cargados tiene que estar en ellos; si no, basta con que tenga forma de
    clave: sin catálogo no es inválido, es incomprobable (ver el skill
    `clientes`), y de todos modos el expediente de cada cliente lo vuelve a
    validar contra su régimen al guardarse.
  */
  const uso = String(formData.get("usoCfdi") ?? "").trim().toUpperCase();
  if (uso) {
    if (!/^[A-Z]{1,3}\d{2}$/.test(uso)) {
      return { ok: false, error: "El uso de CFDI es una clave del SAT, como G03 o S01." };
    }
    const { usos } = await getCatalogosSat();
    if (usos && !usos.has(uso)) {
      return { ok: false, error: `«${uso}» no está en el catálogo de usos de CFDI del SAT.` };
    }
  }

  // Qué cuenta como cliente: al menos una, sin repetidas ni inventadas.
  const pruebas = [
    ...new Set(
      formData
        .getAll("pruebas")
        .map(String)
        .filter((p): p is PruebaDeCliente => (PRUEBAS_DE_CLIENTE as readonly string[]).includes(p)),
    ),
  ];
  if (pruebas.length === 0) {
    return {
      ok: false,
      error: "Marca al menos una prueba de cliente: sin ninguna, todo el padrón pasaría a Ventas como prospecto.",
    };
  }

  const politica = (campo: string): Politica69b | null => {
    const v = String(formData.get(campo) ?? "nada");
    return (POLITICAS_69B as readonly string[]).includes(v) ? (v as Politica69b) : null;
  };
  const presunto = politica("lista69bPresunto");
  const definitivo = politica("lista69bDefinitivo");
  if (!presunto || !definitivo) return { ok: false, error: "Elige qué hacer con la lista 69-B." };

  const valores = {
    clientesSlaHoras: sla,
    clientesUsoCfdiOmision: uso || null,
    clientesPruebas: pruebas,
    clientes69bPresunto: presunto,
    clientes69bDefinitivo: definitivo,
  };

  try {
    const db = await tenantDb();
    await db
      .insert(settings)
      .values({ id: "global", ...valores })
      .onConflictDoUpdate({ target: settings.id, set: { ...valores, updatedAt: new Date() } });
    revalidateTenant();
    return { ok: true, message: "Guardado." };
  } catch (e) {
    console.error("[clientes-config] política", e);
    return { ok: false, error: "No se pudo guardar." };
  }
}
