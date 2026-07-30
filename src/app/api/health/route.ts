import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb, isDbConfigured } from "@/lib/db";

/**
 * Salud del servicio, para el healthcheck de Docker y el balanceo de nginx.
 *
 * Comprueba la base de datos a propósito: un contenedor que responde HTTP
 * pero no alcanza Postgres no está sano, y sin esta verificación el
 * orquestador lo daría por bueno y le mandaría tráfico que va a fallar.
 *
 * Deliberadamente público y sin detalles: reporta si el sistema responde, no
 * su configuración. Un healthcheck que filtra versiones o cadenas de conexión
 * es un regalo para quien escanea.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isDbConfigured) {
    return NextResponse.json(
      { status: "error", db: "unconfigured" },
      { status: 503 },
    );
  }

  try {
    await getDb().execute(sql`select 1`);
    return NextResponse.json({ status: "ok", db: "up" });
  } catch {
    // El detalle va al log del contenedor, no a la respuesta.
    console.error("[health] la base de datos no responde");
    return NextResponse.json({ status: "error", db: "down" }, { status: 503 });
  }
}
