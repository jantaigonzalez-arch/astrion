/**
 * El candado de la suscripción: quién entra y quién no.
 *
 *   npx tsx --tsconfig tsconfig.check.json probe-suscripcion.mts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const { estadoDe, planDe, convieneAvisar, precioDelPlan, PLANES, DIAS_PARA_AVISAR } =
  await import("./src/lib/suscripcion.ts");

let fallos = 0;
const check = (l: string, c: boolean, e = "") => { if (!c) fallos++; console.log(`${c ? "✓" : "✗"} ${l}${e ? ` — ${e}` : ""}`); };

const HOY = new Date("2026-09-04T12:00:00Z");
const enDias = (n: number) => new Date(HOY.getTime() + n * 86_400_000);
const base = { plan: "tierra" };

console.log("── quién entra ──");
check("activa entra", estadoDe({ ...base, status: "active", trialEndsAt: null }, HOY).entra);
check("prueba con días por delante entra",
  estadoDe({ ...base, status: "trial", trialEndsAt: enDias(10) }, HOY).entra);
check("prueba SIN fecha entra (los de antes de esta columna)",
  estadoDe({ ...base, status: "trial", trialEndsAt: null }, HOY).entra);
check("prueba vencida NO entra",
  !estadoDe({ ...base, status: "trial", trialEndsAt: enDias(-1) }, HOY).entra);
check("suspendida NO entra",
  !estadoDe({ ...base, status: "suspended", trialEndsAt: null }, HOY).entra);
check("cancelada NO entra",
  !estadoDe({ ...base, status: "cancelled", trialEndsAt: null }, HOY).entra);
check("un estado desconocido NO entra (cerrado ante la duda)",
  !estadoDe({ ...base, status: "inventado" as never, trialEndsAt: null }, HOY).entra);

console.log("\n── el borde exacto del vencimiento ──");
const casi = estadoDe({ ...base, status: "trial", trialEndsAt: new Date(HOY.getTime() + 3600_000) }, HOY);
check("a una hora del final todavía entra", casi.entra);
check("y se le dice «1 día», no cero",
  casi.clave === "prueba" && casi.dias === 1, casi.clave === "prueba" ? `${casi.dias}` : casi.clave);
check("un segundo después de la fecha ya no entra",
  !estadoDe({ ...base, status: "trial", trialEndsAt: new Date(HOY.getTime() - 1000) }, HOY).entra);

console.log("\n── la cuenta de días ──");
for (const [d, esperado] of [[30, 30], [7, 7], [1, 1]] as const) {
  const e = estadoDe({ ...base, status: "trial", trialEndsAt: enDias(d) }, HOY);
  check(`a ${d} días faltan ${esperado}`, e.clave === "prueba" && e.dias === esperado);
}

console.log("\n── el aviso es discreto ──");
const aviso = (d: number) => convieneAvisar(estadoDe({ ...base, status: "trial", trialEndsAt: enDias(d) }, HOY));
check(`a 30 días NO se avisa (la prueba no es una cobranza)`, !aviso(30));
check(`a ${DIAS_PARA_AVISAR + 1} días tampoco`, !aviso(DIAS_PARA_AVISAR + 1));
check(`a ${DIAS_PARA_AVISAR} días sí`, aviso(DIAS_PARA_AVISAR));
check("a 1 día sí", aviso(1));
check("con la cuenta activa nunca se avisa",
  !convieneAvisar(estadoDe({ ...base, status: "active", trialEndsAt: null }, HOY)));

console.log("\n── los planes ──");
check("existe Tierra", planDe("tierra")?.nombre === "Tierra");
check("y cuesta lo acordado", PLANES.tierra.precioUsd === 320, `${PLANES.tierra.precioUsd} USD`);
check("y se presenta como el escalón estándar", PLANES.tierra.escalon === "Estándar");
// «$320» a secas se lee como 320 PESOS en México: el símbolo es el mismo.
const escrito = precioDelPlan(PLANES.tierra);
check("el precio dice la moneda", escrito === "$320 USD", escrito);
check("y no queda ambiguo con el peso", escrito.includes("USD"));
check("un plan viejo no se disfraza de otro", planDe("poc") === null);
check("ni uno inventado", planDe("plutón") === null);

console.log(fallos === 0 ? "\n✅ sin discrepancias" : `\n✗ ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
