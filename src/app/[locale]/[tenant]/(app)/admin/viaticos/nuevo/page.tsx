import { setRequestLocale } from "next-intl/server";
import { Plane } from "lucide-react";
import { redirectInTenant } from "@/lib/nav-server";
import { currentRole, puedeEn } from "@/lib/tenancy/context";
import {
  contratosParaViatico,
  modulosPorContrato,
  negociosPorProspecto,
  prospectosParaViatico,
  visitasParaViatico,
} from "@/lib/data/viaticos";
import { getSettings } from "@/lib/data/settings";
import { aprobadoresPosibles } from "@/lib/domain/viaticos";
import { auth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import {
  NuevoViaticoForm,
  type ContratoOpcion,
  type EmpresaOpcion,
} from "@/components/portal/viaticos/nuevo-viatico-form";
import type { TipoDestinoViatico } from "@/lib/viaticos";

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
    ¿A QUÉ PUEDE VIAJAR QUIEN MIRA? Lo decide su empresa, por rol (0033, 0037),
    y aquí se pregunta solo para PINTAR: quien decide de verdad es
    `vetoDestinos` en `domain/viaticos.ts`, que lo vuelve a comprobar al
    guardar.

    Que la pantalla y el dominio pregunten lo mismo por su cuenta no es
    duplicación por descuido: es la disciplina de `portal/menu.ts`. Si la
    pantalla no lo preguntara, enseñaría una pestaña que revienta al enviar; si
    el dominio se fiara de la pantalla, bastaría un `curl` para saltársela.

    Dar de alta un prospecto SÍ sigue pidiendo `ventas: editar`: eso ya no es
    pedir un viaje, es escribir en el padrón comercial.
  */
  const [ajustes, rol, puedeCrearProspectos] = await Promise.all([
    getSettings(),
    currentRole(),
    puedeEn("ventas", "editar"),
  ]);
  const puede = (roles: string[]) => Boolean(rol && roles.includes(rol));
  const tipos: TipoDestinoViatico[] = [
    ...(puede(ajustes.viaticosContratosRoles) ? (["contrato"] as const) : []),
    ...(puede(ajustes.viaticosVisitasRoles) ? (["visita"] as const) : []),
    ...(puede(ajustes.viaticosProspectosRoles) ? (["prospecto"] as const) : []),
  ];

  /*
    Cada lista se pide solo si su pestaña existe. Sin esto, cada alta de viático
    leería el padrón comercial entero —161 organizaciones— para no enseñarlo.
  */
  const contratos = tipos.includes("contrato") ? await contratosParaViatico() : [];
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

  const [visitasSinNegocios, prospectosSinNegocios] = await Promise.all([
    tipos.includes("visita") ? visitasParaViatico() : Promise.resolve([]),
    tipos.includes("prospecto") ? prospectosParaViatico() : Promise.resolve([]),
  ]);
  // Los negocios de visitas y prospectos, en UNA consulta para las dos listas.
  const negocios = await negociosPorProspecto([
    ...visitasSinNegocios.map((o) => o.id),
    ...prospectosSinNegocios.map((o) => o.id),
  ]);
  const conNegocios = (orgs: typeof visitasSinNegocios): EmpresaOpcion[] =>
    orgs.map((o) => ({
      id: o.id,
      name: o.name,
      domicilio: o.domicilio,
      negocios: negocios.get(o.id) ?? [],
    }));
  const visitas = conNegocios(visitasSinNegocios);
  const prospectos = conNegocios(prospectosSinNegocios);

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
          LOS VACÍOS, CADA UNO CON SU SALIDA.

          Que el rol no pueda pedir nada es una decisión de la empresa, y se dice
          dónde se cambia. Que no haya a quién viajar se mide contra TODAS las
          listas que su rol puede usar, no solo contra los contratos: con visitas
          o prospectos encendidos, una empresa sin contratos sigue pudiendo pedir
          viajes, y el mensaje viejo le habría dicho que no se puede nada.
        */}
        {tipos.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Tu rol no puede pedir viáticos a ningún destino. Quien administre
            viáticos decide qué roles pueden, en Configuración → Viáticos.
          </p>
        ) : contratos.length === 0 && visitas.length === 0 && prospectos.length === 0 && !(tipos.includes("prospecto") && puedeCrearProspectos) ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No hay contratos, clientes ni prospectos a los que tu rol pueda viajar.
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
            visitas={visitas}
            prospectos={prospectos}
            aprobadores={aprobadores}
            tipos={tipos}
            maxPorTipo={ajustes.viaticosMaxPorTipo}
            mezclar={ajustes.viaticosMezclarDestinos}
            puedeCrearProspectos={tipos.includes("prospecto") && puedeCrearProspectos}
          />
        )}
      </Card>
    </div>
  );
}
