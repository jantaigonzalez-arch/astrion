import { setRequestLocale } from "next-intl/server";
import { Plane } from "lucide-react";
import { redirectInTenant } from "@/lib/nav-server";
import { puedeEn } from "@/lib/tenancy/context";
import {
  contratosParaViatico,
  modulosPorContrato,
  negociosPorProspecto,
  prospectosParaViatico,
} from "@/lib/data/viaticos";
import { getSettings } from "@/lib/data/settings";
import { aprobadoresPosibles } from "@/lib/domain/viaticos";
import { auth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import {
  NuevoViaticoForm,
  type ContratoOpcion,
  type ProspectoOpcion,
} from "@/components/portal/viaticos/nuevo-viatico-form";

export const dynamic = "force-dynamic";

export default async function NuevoViaticoPage({
  params,
}: {
  params: Promise<{ locale: string; tenant: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!(await puedeEn("viaticos", "editar"))) {
    await redirectInTenant("/admin/viaticos", locale);
  }

  const session = await auth();
  const yo = session!.user.id;

  /*
    ¿SE PUEDE VIAJAR A UN PROSPECTO? Dos condiciones, y las dos se piden aquí
    solo para PINTAR: quien decide de verdad es `domain/viaticos.ts`, que las
    vuelve a comprobar al guardar.

    Que la pantalla y el dominio pregunten lo mismo por su cuenta no es
    duplicación por descuido: es la misma disciplina que ya está escrita en
    `portal/menu.ts`. Si la pantalla no lo preguntara, enseñaría una pestaña que
    revienta al enviar; si el dominio se fiara de la pantalla, bastaría un
    `curl` para saltársela.
  */
  const [ajustes, puedeVerVentas, puedeCrearProspectos] = await Promise.all([
    getSettings(),
    puedeEn("ventas", "ver"),
    puedeEn("ventas", "editar"),
  ]);
  const permiteProspectos = ajustes.viaticosProspectos && puedeVerVentas;

  const contratos = await contratosParaViatico();
  /*
    Los módulos de TODOS los contratos, en UNA consulta.

    El formulario los necesita cargados para llenar el segundo campo sin ir a la
    red cada vez que se cambia el primero. Esto se hacía con un `Promise.all`
    que llamaba a `modulosDelContrato` por contrato: 55 consultas para pintar la
    pantalla, y una más por cada contrato que se firme.

    Medido: 55 → 2 consultas y 29,6 → 6,5 ms. Ver `modulosPorContrato`.
  */
  const porContrato = await modulosPorContrato(contratos.map((c) => c.id));
  const conModulos: ContratoOpcion[] = contratos.map((c) => ({
    id: c.id,
    number: c.number,
    cliente: c.cliente,
    domicilio: c.domicilio,
    modulos: porContrato.get(c.id) ?? [],
  }));

  /*
    Los prospectos y sus negocios solo se piden cuando la pestaña existe. Sin
    esto, cada alta de viático leería el padrón comercial entero —161
    organizaciones— para no enseñarlo.
  */
  const prospectos: ProspectoOpcion[] = permiteProspectos
    ? await (async () => {
        const orgs = await prospectosParaViatico();
        const negocios = await negociosPorProspecto(orgs.map((o) => o.id));
        return orgs.map((o) => ({
          id: o.id,
          name: o.name,
          domicilio: o.domicilio,
          negocios: negocios.get(o.id) ?? [],
        }));
      })()
    : [];

  // Sin uno mismo: no se firma lo que uno pide, así que ofrecerse en la lista
  // sería ofrecer un camino que el dominio va a cerrar.
  const aprobadores = await aprobadoresPosibles(yo);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Plane className="size-5 text-primary" />
          Pedir viáticos
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Lo autoriza quien administra el gasto. Al volver, aquí mismo cargas
          tus comprobantes.
        </p>
      </div>

      <Card className="p-5">
        {/*
          EL VACÍO SE MIDE CONTRA LOS DOS ASUNTOS, no solo contra los contratos.

          Con la pestaña de prospectos encendida, una empresa sin contratos
          firmados sigue pudiendo pedir viajes de prospección — y el mensaje
          viejo le habría dicho que no se puede pedir nada.
        */}
        {contratos.length === 0 && prospectos.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {permiteProspectos
              ? "No hay contratos ni prospectos capturados. Un viático se carga a uno de los dos."
              : "No hay contratos de servicio capturados. Un viático se carga siempre a un contrato."}
          </p>
        ) : aprobadores.length === 0 ? (
          /*
            Nadie a quien mandárselo. Pasa en una empresa recién dada de alta
            donde el dueño es el único usuario: es él quien viaja y no puede
            firmarse a sí mismo. Decirlo aquí evita que rellene el formulario
            entero para toparse con el error al final.
          */
          <p className="py-8 text-center text-sm text-muted-foreground">
            No hay nadie que pueda autorizar tus viáticos. Hace falta al menos
            otra persona con permiso para administrarlos.
          </p>
        ) : (
          <NuevoViaticoForm
            contratos={conModulos}
            prospectos={prospectos}
            aprobadores={aprobadores}
            permiteProspectos={permiteProspectos}
            puedeCrearProspectos={permiteProspectos && puedeCrearProspectos}
          />
        )}
      </Card>
    </div>
  );
}
