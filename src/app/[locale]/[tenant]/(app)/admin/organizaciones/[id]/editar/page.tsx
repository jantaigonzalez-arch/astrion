import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import {
  getClientAccounts,
  getCrmOwners,
  getExpedienteFiscal,
  getOrganizationById,
} from "@/lib/data/crm";
import { getRegimenesPara, getUsosPara } from "@/lib/data/sat";
import { puedeEn } from "@/lib/tenancy/context";
import { ExpedienteFiscalForm } from "@/components/portal/clientes/expediente-fiscal-form";
import { Receipt } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/nav";
import { redirectInTenant } from "@/lib/nav-server";
import { puedeEnAlguno } from "@/lib/tenancy/context";
import { OrganizationForm } from "@/components/portal/crm/crm-forms";

export default async function EditOrganizationPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  // Ver la ficha y CAMBIARLA no son lo mismo. El layout ya filtró a quien no
  // tiene nada que hacer aquí; esto exige además poder escribir, en cualquiera
  // de las dos puertas.
  if (!(await puedeEnAlguno(["ventas", "clientes"], "editar"))) {
    await redirectInTenant("/admin/organizaciones", locale);
  }

  const org = await getOrganizationById(id);
  if (!org) notFound();

  /*
    El expediente fiscal se carga aquí aunque quizá no se pinte.

    Quién puede TOCARLO es una pregunta aparte: cambiar un teléfono es
    `clientes:editar` y cambiar el RFC con el que se factura es
    `clientes:administrar`. La página deja entrar con el permiso bajo —para eso
    está el formulario de arriba— y esconde el bloque fiscal a quien no tiene el
    alto, en vez de negarle la pantalla entera por un campo que no iba a tocar.
  */
  const [owners, clients, fiscal, puedeFiscal] = await Promise.all([
    getCrmOwners(),
    getClientAccounts(),
    getExpedienteFiscal(id),
    puedeEn("clientes", "administrar"),
  ]);

  /*
    Los selectores se filtran por lo que ya se sabe: los regímenes por el tipo de
    persona que dice el RFC guardado, y los usos por el régimen guardado.

    Con los catálogos del SAT sin cargar las dos listas vuelven vacías, y el
    formulario cae a campos de texto avisando de por qué. Es preferible a un
    desplegable vacío, que parecería decir que no hay ningún régimen válido.
  */
  const [regimenes, usos] = await Promise.all([
    getRegimenesPara(
      fiscal?.personaTipo === "fisica" || fiscal?.personaTipo === "moral"
        ? fiscal.personaTipo
        : null,
    ),
    getUsosPara(fiscal?.regimenFiscal ?? null),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/admin/organizaciones/${org.id}`}>
            <ArrowLeft className="size-4" /> Volver a la organización
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Editar organización
        </h1>
        <p className="text-sm text-muted-foreground">
          Enlaza la <strong>cuenta de portal</strong> para ver aquí sus
          contratos, equipos y tickets.
        </p>
      </div>

      <Card className="p-6">
        <OrganizationForm
          owners={owners}
          clients={clients}
          defaults={{
            id: org.id,
            name: org.name,
            industry: org.industry,
            website: org.website,
            phone: org.phone,
            address: org.address,
            street: org.street,
            extNumber: org.extNumber,
            intNumber: org.intNumber,
            neighborhood: org.neighborhood,
            municipality: org.municipality,
            state: org.state,
            postalCode: org.postalCode,
            addressReference: org.addressReference,
            ownerId: org.ownerId,
            clientId: org.clientId,
            slaHours: org.slaHours,
            notes: org.notes,
          }}
        />
      </Card>

      {/*
        ── EL EXPEDIENTE FISCAL, EN SU PROPIA TARJETA Y CON SU PROPIO BOTÓN ──

        Podría haber sido un `fieldset` más del formulario de arriba, con un solo
        «Guardar». Se separa por tres razones, y ninguna es estética:

        1. EL PERMISO ES OTRO. Un solo formulario obligaría a exigir
           `clientes:administrar` para cambiar un teléfono, o a dejar tocar el
           RFC a quien solo tiene `editar`. Las dos opciones son malas.

        2. UN FALLO NO DEBE ARRASTRAR AL OTRO. Que el régimen esté mal no es
           motivo para no guardar el teléfono que alguien acaba de corregir.
           Juntos, cualquier error deja sin guardar todo lo demás.

        3. LOS ERRORES TIENEN OTRA FORMA: aquí se contesta por campo y con los
           códigos del SAT, que se pueden pegar en un buscador.

        Es el mismo criterio que separa `cliente_fiscal` de `cliente_comercial`
        en la base.
      */}
      {puedeFiscal && (
        <Card className="p-6">
          <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Receipt className="size-4 text-primary" /> Datos fiscales (CFDI 4.0)
          </h2>
          <p className="mb-5 text-sm text-muted-foreground">
            Lo que viaja en el nodo <span className="font-mono">Receptor</span> de la
            factura. Desde CFDI 4.0 el SAT lo contrasta contra su padrón al timbrar:
            un dato que no coincida es un rechazo, no un aviso.
          </p>
          <ExpedienteFiscalForm
            defaults={{
              organizationId: org.id,
              rolFiscal: fiscal?.rolFiscal ?? "normal",
              rfc: fiscal?.rfc ?? null,
              nombreFiscal: fiscal?.nombreFiscal ?? null,
              nombreCapturado: fiscal?.nombreCapturado ?? null,
              regimenFiscal: fiscal?.regimenFiscal ?? null,
              cpFiscal: fiscal?.cpFiscal ?? null,
              paisResidencia: fiscal?.paisResidencia ?? null,
              numRegIdTrib: fiscal?.numRegIdTrib ?? null,
              curp: fiscal?.curp ?? null,
              usoCfdiDefault: fiscal?.usoCfdiDefault ?? null,
              domicilio: fiscal?.domicilio ?? null,
            }}
            regimenes={regimenes.map((r) => ({
              clave: r.clave,
              descripcion: r.descripcion,
            }))}
            usos={usos.map((u) => ({ clave: u.clave, descripcion: u.descripcion }))}
            nombreOrganizacion={org.name}
            rfcDelPadron={org.taxId}
          />
        </Card>
      )}
    </div>
  );
}
