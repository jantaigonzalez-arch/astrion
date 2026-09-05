import { redirectInTenant } from "@/lib/nav-server";
import { puedeEnAlguno } from "@/lib/tenancy/context";

/**
 * LA FICHA DE LA EMPRESA NO ES DE VENTAS NI DE SERVICIO.
 *
 * Vivía dentro de `/admin/crm`, y por eso la heredaba entera: quien no tuviera
 * Ventas no podía abrir la ficha de un cliente suyo, y todo lo que se configura
 * de un cliente —el SLA, el RFC, la cuenta de portal— quedaba tras una puerta
 * que decía «CRM». Ese fue el reporte: «no veo la opción de SLA en cada uno de
 * los clientes».
 *
 * Es un solo registro con dos lecturas. Mientras es prospecto lo trabaja
 * Ventas; cuando compra, pasa a ser cliente y lo atiende Servicio. Partirlo en
 * dos tablas sería la solución obvia y la equivocada: el día que el prospecto
 * compra habría que migrar la fila —y perder su historia— o copiarla —y tener
 * la misma empresa dos veces—. Así que la fila es una y el permiso admite las
 * dos puertas.
 *
 * ── POR QUÉ EL GUARDIA ESTÁ AQUÍ Y NO EN CADA PÁGINA ──────────────────────
 *
 * Porque al sacar estas páginas del CRM se quedaron sin ninguno: la ficha y su
 * formulario no tenían `puedeEn` propio, se apoyaban en el layout del CRM. Un
 * layout es lo único que cubre también a las rutas que alguien agregue mañana
 * debajo.
 */
export default async function OrganizacionesLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // Basta con verla desde UNA de las dos: son dos maneras de tener asunto con
  // la misma empresa, no dos requisitos. Es la misma disyunción que declara
  // `RUTAS` en `permisos.ts`, y las dos tienen que decir lo mismo o la barra
  // lateral enseñaría un enlace que la página rechaza.
  if (!(await puedeEnAlguno(["ventas", "clientes"], "ver"))) {
    await redirectInTenant("/dashboard", locale);
  }

  return children;
}
