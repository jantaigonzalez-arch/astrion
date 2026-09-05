import { setRequestLocale } from "next-intl/server";
import { redirectInTenant } from "@/lib/nav-server";
import {
  CAMPOS_ORDEN_PROVEEDORES,
  ESTADOS_PROVEEDOR,
  ESTADO_PROVEEDOR_LABEL,
  ORDEN_PROVEEDORES_DEFECTO,
  contarProveedores,
  getSuppliers,
} from "@/lib/data/purchasing";
import { parseFiltro, parseOrden, queryLimpia } from "@/lib/listado";
import { ResumenFiltros, ThOrden } from "@/components/portal/listado-controles";
import { FiltroColumna } from "@/components/portal/filtro-columna";
import { AddSupplierForm } from "@/components/portal/purchasing/supplier-forms";
import { SupplierRows } from "@/components/portal/purchasing/supplier-rows";
import { Card } from "@/components/ui/card";
import { puedeEn } from "@/lib/tenancy/context";

const BASE = "/admin/compras/proveedores";

export default async function ProveedoresPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    orden?: string;
    dir?: string;
    estado?: string;
    moneda?: string;
  }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!(await puedeEn("compras", "ver"))) {
    await redirectInTenant("/dashboard", locale);
  }
  const admin = await puedeEn("compras", "administrar");

  // El orden y los filtros viajan en la URL: un padrón ordenado por días de
  // crédito y acotado a dólares es una vista concreta —«a quién le pagamos en
  // dólares y a más plazo»— y esa vista tiene que caber en un mensaje.
  const sp = await searchParams;
  const orden = parseOrden(sp, CAMPOS_ORDEN_PROVEEDORES, ORDEN_PROVEEDORES_DEFECTO);
  const filtros = {
    estado: parseFiltro(sp.estado, ESTADOS_PROVEEDOR),
    moneda: sp.moneda,
  };
  // Lo que viaja pegado al orden y a cada filtro cuando se pulsa otro: sin
  // esto, cambiar de columna perdería el filtro puesto.
  const query = queryLimpia({ estado: filtros.estado, moneda: filtros.moneda });

  const [rows, conteos] = await Promise.all([
    getSuppliers(false, false, orden, filtros),
    contarProveedores(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Proveedores</h1>
            <p className="text-sm text-muted-foreground">
              A quién se le compra. Los días de crédito son los que se van a usar
              después para cuentas por pagar.
            </p>
          </div>
          <AddSupplierForm />
        </div>
      </div>

      {rows.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="font-medium">Todavía no hay proveedores.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Da de alta al primero para poder levantar una orden de compra.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          {/* Con los embudos metidos en los encabezados se gana sitio y se
              pierde ver de un vistazo POR QUÉ la tabla enseña 4 filas y no 40.
              Esta línea lo dice, y solo cuando hay algo que decir. */}
          <ResumenFiltros
            basePath={BASE}
            query={query}
            puestos={[
              filtros.estado && {
                clave: "estado",
                titulo: "Estado",
                valor: ESTADO_PROVEEDOR_LABEL[filtros.estado],
              },
              filtros.moneda && {
                clave: "moneda",
                titulo: "Moneda",
                valor: filtros.moneda,
              },
            ].filter((x): x is { clave: string; titulo: string; valor: string } =>
              Boolean(x),
            )}
          />
          <div className="overflow-x-auto">
            <table data-tabla="proveedores" className="tabla-erp w-full text-sm">
              <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  {/*
                    El filtro de estado vive en la columna del NOMBRE, que es
                    donde se enseña: las insignias de «suspendido» y «de baja»
                    se pintan junto al proveedor, no en una columna aparte.
                    Filtrar por una columna que no existe obligaría a inventarla
                    solo para alojar el embudo.
                  */}
                  <ThOrden
                    campo="nombre"
                    actual={orden}
                    basePath={BASE}
                    query={query}
                    filtro={
                      <FiltroColumna
                        titulo="Estado"
                        clave="estado"
                        activo={filtros.estado}
                        basePath={BASE}
                        query={query}
                        opciones={[
                          { label: "Todos" },
                          ...conteos.estado.map((e) => ({
                            valor: e.k,
                            label: ESTADO_PROVEEDOR_LABEL[e.k],
                            n: e.n,
                          })),
                        ]}
                      />
                    }
                  >
                    Proveedor
                  </ThOrden>
                  <ThOrden campo="rfc" actual={orden} basePath={BASE} query={query}>
                    RFC
                  </ThOrden>
                  {/* Contacto no ordena: son tres datos en una celda —nombre,
                      correo y teléfono— y ordenar por «el contacto» no
                      significa nada. Una columna que ordena por algo que no se
                      puede nombrar enseña a desconfiar del resto. */}
                  <th className="px-4 py-3 font-medium">Contacto</th>
                  <ThOrden campo="credito" actual={orden} basePath={BASE} query={query} numerica>
                    Crédito
                  </ThOrden>
                  <ThOrden
                    campo="moneda"
                    actual={orden}
                    basePath={BASE}
                    query={query}
                    filtro={
                      <FiltroColumna
                        titulo="Moneda"
                        clave="moneda"
                        activo={filtros.moneda}
                        basePath={BASE}
                        query={query}
                        opciones={[
                          { label: "Todas" },
                          ...conteos.moneda.map((m) => ({ valor: m.k, label: m.k, n: m.n })),
                        ]}
                      />
                    }
                  >
                    Moneda
                  </ThOrden>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <SupplierRows suppliers={rows} canDelete={admin} />
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
