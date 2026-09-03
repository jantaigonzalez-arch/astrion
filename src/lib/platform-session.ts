import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { platformUsers } from "@/lib/db/platform";
import { auth } from "@/lib/auth";
import type { PlatformRole } from "@/lib/auth";

/**
 * El rol de PLATAFORMA de quien está operando, leído de la base en cada
 * petición.
 *
 * ── POR QUÉ NO SE LEE DEL TOKEN ───────────────────────────────────────────
 *
 * Porque el token es una fotografía del día que la persona entró. La sesión es
 * JWT —no hay tabla de sesiones que invalidar—, así que `session.user.platformRole`
 * dice lo que era cierto entonces y no lo que es cierto ahora. Degradar a un
 * superadministrador a soporte, o desactivar su cuenta, no surtía efecto hasta
 * que el token caducara: treinta días por omisión.
 *
 * Y esto es el rol de mayor alcance del producto. Un operador de plataforma
 * entra a la empresa de CUALQUIER cliente; un superadministrador además da de
 * alta empresas y aprueba solicitudes. Que revocarlo tarde un mes no es un
 * detalle de frescura, es que no hay forma de revocarlo.
 *
 * ── EL PRECEDENTE YA ESTABA DEL OTRO LADO ────────────────────────────────
 *
 * El rol DENTRO de una empresa nunca salió del token: `currentRole()` lee
 * `memberships` en cada petición, y por eso quitarle la membresía a alguien lo
 * deja fuera al instante. Esto es lo mismo para la otra mitad del modelo. La
 * asimetría era el defecto: la mitad barata de revocar era la de menos alcance.
 *
 * ── EL COSTO ─────────────────────────────────────────────────────────────
 *
 * Una consulta por petición, y solo para sesiones de plataforma —que son un
 * puñado de personas contra todos los usuarios de todos los clientes—.
 * Memoizada con `cache()` de React, igual que `getTenantContext`, así que una
 * pantalla que la pregunta cinco veces la consulta una.
 *
 * ── QUÉ DEVUELVE ─────────────────────────────────────────────────────────
 *
 * `null` cuando no hay sesión, cuando la sesión es de un inquilino, cuando la
 * cuenta se borró y cuando está desactivada. Los cuatro significan lo mismo
 * para quien pregunta —esta persona no opera la plataforma— y distinguirlos
 * obligaría a cada llamada a decidir qué hacer con cada caso.
 */
export const currentPlatformRole = cache(
  async function currentPlatformRole(): Promise<PlatformRole> {
    const session = await auth();
    // `kind` y no la presencia del rol: de qué TABLA salió la sesión es el
    // hecho, y `auth.ts` no copia el rol en tokens de inquilino. Ver la nota
    // de `getTenantContext` sobre por qué cruzar los dos ids fue un agujero.
    if (session?.user?.kind !== "platform" || !session.user.id) return null;

    const [op] = await getDb()
      .select({ role: platformUsers.role, active: platformUsers.active })
      .from(platformUsers)
      .where(eq(platformUsers.id, session.user.id))
      .limit(1);

    if (!op || !op.active) return null;
    return op.role;
  },
);

/** ¿Es superadministrador AHORA? La pregunta que gobierna alta y aprobación. */
export async function isPlatformSuperadmin(): Promise<boolean> {
  return (await currentPlatformRole()) === "superadmin";
}
