-- EL DOMICILIO, DESARMADO COMO LO PIDE EL SAT.
--
-- Hasta hoy era un solo `address` de texto libre. Vino así del padrón de SAE
-- —«CALLE, NÚMERO, COLONIA, MUNICIPIO, ESTADO, CP» separado por comas— y para
-- leerlo bastaba; para timbrar un CFDI, no.
--
-- ── QUÉ PIDE EL SAT DE VERDAD ─────────────────────────────────────────────
--
-- En CFDI 4.0 el único dato de domicilio OBLIGATORIO del receptor es
-- `DomicilioFiscalReceptor`: el CÓDIGO POSTAL, cinco dígitos, y tiene que ser
-- idéntico al que el SAT tiene registrado en la Constancia de Situación Fiscal.
-- Es el dato que más rechazos causa. Los demás campos —calle, número, colonia—
-- no viajan en el comprobante, pero sí forman el nodo `Domicilio` de los
-- complementos (Carta Porte) y son los que hay que tener capturados el día que
-- haga falta uno; capturarlos ahora cuesta lo mismo y evita recapturar 161
-- fichas después.
--
-- Los nombres siguen el nodo `Domicilio` del SAT: Calle, NumeroExterior,
-- NumeroInterior, Colonia, Localidad, Referencia, Municipio, Estado, Pais,
-- CodigoPostal.
--
-- ── POR QUÉ NO SE BORRA `address` ─────────────────────────────────────────
--
-- Porque 148 fichas lo tienen y el desarmado se hace por separado, con reporte
-- de incidencias (ver `scripts/domicilios.ts`). Tirar el original en la misma
-- migración que crea las columnas dejaría sin red a lo que el parser no
-- entienda, y hay cinco direcciones que ya se sabe que no traen código postal.
-- Queda como el texto tal cual se capturó, y la pantalla lo enseña solo cuando
-- no hay nada estructurado.
--
-- Todo nulo: ninguna fila existente cambia de comportamiento.

alter table crm_organizations
  add column if not exists street             varchar(200),
  add column if not exists ext_number         varchar(55),
  add column if not exists int_number         varchar(55),
  add column if not exists neighborhood       varchar(120),
  add column if not exists locality           varchar(120),
  add column if not exists municipality       varchar(120),
  add column if not exists state              varchar(120),
  add column if not exists postal_code        varchar(5),
  -- Clave del catálogo c_Pais del SAT. México es MEX y es lo que será siempre
  -- aquí, pero se guarda explícito: un domicilio sin país no se puede mandar a
  -- un complemento, y rellenarlo al vuelo sería adivinar.
  add column if not exists country            varchar(3) default 'MEX',
  add column if not exists address_reference  varchar(250);

-- El código postal es la llave de búsqueda del área de facturación —«el cliente
-- del 64460»— y el campo que hay que cruzar contra la Constancia. Parcial
-- porque hoy la mayoría está vacío y no tiene sentido indexar los nulos.
create index if not exists crm_organizations_postal_idx
  on crm_organizations (postal_code)
  where postal_code is not null;
