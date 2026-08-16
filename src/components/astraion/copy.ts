/**
 * Textos de la página de la iniciativa.
 *
 * Viven aquí y no en `src/messages/*.json` a propósito: son la copia de UNA
 * página autocontenida, y meterlos en el diccionario compartido de la app
 * obligaría a mantener cientos de claves que ninguna otra pantalla usa. Si la
 * iniciativa crece a varias páginas, se mueven.
 */

export type PlatformCopy = ReturnType<typeof getCopy>;

const es = {
  brand: "Astraion",
  nav: {
    arquitectura: "Arquitectura",
    modulos: "Módulos",
    caso: "El caso Evoelution",
    acceso: "Solicitar acceso",
    entrar: "Entrar",
  },

  hero: {
    eyebrow: "ERP + Machine Learning",
    // El titular dice qué es y para quién. Es lo único que abre la página: la
    // tesis («una pyme no decide peor…») y el duelo de las dos respuestas
    // vivían aquí y se retiraron — el «para una PYME» del titular ya carga con
    // esa idea sin gastar media pantalla.
    h1a: "El primer ERP con",
    h1em: "machine learning adentro",
    h1b: "para una PYME",
    claim:
      "No un módulo de IA colgado encima: tres capas en un solo sistema —datos, historia e inteligencia—.",
  },

  forecast: {
    tag: "Ejemplo",
    title: "Consumo mensual",
    part: "Sello de bomba · WAT270919",
    unit: "piezas",
    history: "Histórico · 14 meses",
    model: "Pronóstico · 4 meses",
    band: "Banda 80 %",
    today: "hoy",
    readoutLabel: "Punto de reorden sugerido",
    readoutValue: "8",
    readoutUnit: "piezas",
    foot: "Sale del libro mayor de inventario. Nadie captura nada aparte.",
  },

  layers: {
    eyebrow: "La arquitectura",
    title: "Tres capas, un solo sistema",
    lede: "Cada una se apoya en la de abajo. Sin la segunda, la tercera no existe.",
    ceiling: "Aquí para un ERP tradicional",
    stack: [
      {
        n: "3",
        name: "Inteligencia",
        body: "Los modelos deciden dentro del ERP, no en un tablero aparte.",
      },
      {
        n: "2",
        name: "Historia",
        body: "Una bitácora que nadie puede reescribir. Sin pasado no hay modelo.",
      },
      {
        n: "1",
        name: "Datos",
        body: "La operación completa: servicio, inventario, compras, ventas.",
      },
    ],
  },

  modules: {
    eyebrow: "La capa 1",
    title: "El ERP completo",
    lede: "Ya construido y corriendo.",
    groups: [
      {
        name: "Servicio",
        items: [
          "Cola de tickets",
          "Levantamientos",
          "Equipos y parque instalado",
          "Reportes de servicio",
          "Portal del cliente",
        ],
      },
      {
        name: "Inventario",
        items: ["Refacciones", "Libro mayor de inventario", "Catálogo"],
      },
      {
        name: "Compras",
        items: ["Órdenes de compra", "Proveedores", "Cuentas por pagar"],
      },
      {
        name: "Ventas",
        items: [
          "Embudo de negocios",
          "Leads",
          "Organizaciones y contactos",
          "Actividades",
          "Contratos",
          "Objetivos",
        ],
      },
      {
        name: "Análisis",
        items: ["Rentabilidad", "Informes comerciales", "ML y predicciones"],
      },
      {
        name: "Configuración",
        items: ["Usuarios y permisos", "Embudos", "Plantillas", "Automatizaciones"],
      },
    ],
    proof:
      "Corriendo hoy en Evoelution, el primer cliente: 602 tickets · 257 equipos · 161 clientes · 2 766 horas.",
  },

  gap: {
    eyebrow: "La brecha",
    title: "Lo que separaba a una empresa de la otra tenía precio",
    lede: "No era una idea, era una factura. Y por eso la brecha se sostuvo durante veinte años.",
    meterTitle: "Distancia entre decidir con datos y decidir sin ellos",
    small: "empresa chica",
    big: "empresa grande",
    label: "brecha",
    items: [
      {
        kicker: "Costaba",
        title: "Un equipo de datos",
        body: "Alguien que entienda el negocio y sepa modelar. Una plaza que una empresa de treinta personas no abre para un pronóstico de compras.",
      },
      {
        kicker: "Costaba",
        title: "Un almacén de datos",
        body: "Sacar la información del sistema operativo, limpiarla y guardarla con su historia. Meses de proyecto antes del primer modelo.",
      },
      {
        kicker: "Y sobre todo",
        title: "Historia que nadie guardó",
        body: "El obstáculo real. Casi todo sistema administrativo guarda el estado de hoy y sobrescribe el de ayer. Sin pasado no hay nada que aprender.",
      },
    ],
  },

  now: {
    eyebrow: "Por qué ahora sí",
    title: "Porque el ERP ya tiene los datos. Solo le faltaba recordar.",
    lede: "Nadie captura información para un modelo. La captura para trabajar: abre un ticket, registra las horas, descuenta una refacción, mueve un negocio de etapa. Ese es el dato que un modelo necesita, y ya se está escribiendo.",
    items: [
      {
        kicker: "La decisión de diseño",
        title: "Guardar la historia, no solo el estado",
        body: "Cada cambio queda escrito en una bitácora que la base de datos impide reescribir. Es la diferencia entre poder reconstruir en qué situación estaba algo hace treinta días y no poder. Sin eso, cualquier modelo aprende del desenlace que ya conoce y falla en cuanto se usa de verdad.",
      },
      {
        kicker: "Lo que se elimina",
        title: "El proyecto de extracción",
        body: "Así decide una empresa grande: saca los datos del sistema operativo, los lleva a otra capa, los procesa ahí y devuelve un tablero. Esa mudanza es la mitad del costo y todo el retraso. En Astraion la capa de decisión vive dentro del mismo sistema que produce el dato: no hay nada que extraer.",
      },
      {
        kicker: "La consecuencia",
        title: "El modelo viaja con el sistema",
        body: "No hay integración que contratar ni proyecto que arrancar. La empresa opera como opera y el sistema acumula lo que hace falta. El primer modelo útil no llega después de seis meses de proyecto: llega cuando hay suficiente historia, que es otra cosa.",
      },
    ],
  },

  decisions: {
    eyebrow: "Qué decide",
    title: "Decisiones concretas, no «inteligencia» en abstracto",
    lede: "Cada una responde a una pregunta que alguien ya se hace todas las semanas, hoy a ojo.",
    states: { live: "Funcionando", dev: "En desarrollo", next: "Con datos, sin modelo" },
    rows: [
      {
        q: "¿Cuántas piezas de cada refacción compro?",
        src: "Consumo histórico del libro mayor de inventario",
        state: "dev" as const,
      },
      {
        q: "¿Qué ticket no va a cumplir su fecha límite?",
        src: "Historia de tickets del mismo equipo y categoría",
        state: "dev" as const,
      },
      {
        q: "¿Qué cliente no va a renovar su contrato?",
        src: "Contratos por vencer cruzados con la actividad del año",
        state: "next" as const,
      },
      {
        q: "¿Qué negocio del embudo se va a cerrar?",
        src: "Eventos de cambio de etapa y tiempo en cada una",
        state: "next" as const,
      },
      {
        q: "¿Qué corrida analítica se salió del patrón?",
        src: "Cromatografía · detección de anomalías",
        state: "live" as const,
      },
    ],
    disclaimerTitle: "Lo que esto no promete.",
    disclaimer:
      "Un modelo no adivina sin historia: una empresa que arranca de cero necesita meses de operación antes de que su primer pronóstico valga algo. Tampoco decide por nadie — ordena, estima y señala; la decisión sigue siendo de quien responde por ella. Decirlo así importa: la mayor parte del desencanto con estas herramientas viene de haberlas vendido de otra manera.",
  },

  compound: {
    eyebrow: "El efecto compuesto",
    title: "Y una ventaja más para la empresa chica: cincuenta saben más que una",
    lede: "Aquí la escala se invierte. Una empresa grande aprende solo de sí misma; una chica, dentro de una plataforma, puede aprender de todas las que quisieron aportar.",
    items: [
      {
        title: "Nadie aporta sin decirlo",
        body: "El aporte de datos nace apagado y se otorga de forma explícita, con responsable y fecha. Es revocable, y al revocarse esa empresa sale del siguiente entrenamiento. Los datos de cada cliente viven en su propio esquema, aislados de los demás.",
      },
      {
        title: "Quien llega nuevo no arranca a ciegas",
        body: "Ese es el trato: predecir la falla de una bomba con la historia de un laboratorio es estadística pobre; con la de cincuenta es un producto. El modelo sirve a todos, hayan aportado o no.",
      },
    ],
  },

  signup: {
    eyebrow: "Solicitar acceso",
    title: "Astraion no se contrata con un clic.",
    lede:
      "Cada empresa que entra recibe su propio esquema aislado, y eso se aprovisiona a mano por ahora. Deja los datos y te escribimos: si el producto todavía no te sirve, preferimos decírtelo antes que después.",
    fields: {
      company: "Empresa",
      contact: "Tu nombre",
      email: "Correo",
      phone: "Teléfono (opcional)",
      size: "Personas",
      industry: "Giro (opcional)",
      note: "¿Qué decisión quieres dejar de tomar de memoria?",
    },
    sizes: ["1–10", "11–30", "31–80", "81–200", "200+"],
    industryPlaceholder: "Laboratorio, distribución, manufactura…",
    notePlaceholder:
      "Cuánto comprar, a quién visitar, qué equipo está por fallar…",
    submit: "Enviar solicitud",
    sending: "Enviando…",
    doneTitle: "Solicitud recibida.",
    doneBody:
      "Queda en la bandeja del equipo. Si tu empresa encaja, te llega el acceso con tu propio espacio ya creado.",
    privacy:
      "Estos datos solo se usan para responderte. No hay cuenta creada ni acceso otorgado hasta que alguien revise la solicitud.",
  },

  footer: {
    a: "ERP con Machine Learning para empresas pequeñas",
    b: "Hecho en México",
  },
} as const;

const en = {
  brand: "Astraion",
  nav: {
    arquitectura: "Architecture",
    modulos: "Modules",
    caso: "The Evoelution case",
    acceso: "Request access",
    entrar: "Sign in",
  },

  hero: {
    eyebrow: "ERP + Machine Learning",
    h1a: "The first ERP with",
    h1em: "machine learning inside",
    h1b: "for a small business",
    claim:
      "Not an AI module bolted on top: three layers in a single system — data, history and intelligence.",
  },

  forecast: {
    tag: "Example",
    title: "Monthly consumption",
    part: "Pump seal · WAT270919",
    unit: "units",
    history: "History · 14 months",
    model: "Forecast · 4 months",
    band: "80% band",
    today: "today",
    readoutLabel: "Suggested reorder point",
    readoutValue: "8",
    readoutUnit: "units",
    foot: "It comes from the inventory ledger. Nobody keys in anything extra.",
  },

  layers: {
    eyebrow: "The architecture",
    title: "Three layers, one system",
    lede: "Each rests on the one below. Without the second, the third does not exist.",
    ceiling: "This is where a traditional ERP stops",
    stack: [
      {
        n: "3",
        name: "Intelligence",
        body: "The models decide inside the ERP, not on a separate dashboard.",
      },
      {
        n: "2",
        name: "History",
        body: "A log nobody can rewrite. With no past there is no model.",
      },
      {
        n: "1",
        name: "Data",
        body: "The full operation: service, inventory, purchasing, sales.",
      },
    ],
  },

  modules: {
    eyebrow: "Layer 1",
    title: "The full ERP",
    lede: "Already built and running.",
    groups: [
      {
        name: "Service",
        items: [
          "Ticket queue",
          "Service intake",
          "Machines and installed base",
          "Service reports",
          "Client portal",
        ],
      },
      {
        name: "Inventory",
        items: ["Spare parts", "Inventory ledger", "Catalog"],
      },
      {
        name: "Purchasing",
        items: ["Purchase orders", "Suppliers", "Accounts payable"],
      },
      {
        name: "Sales",
        items: [
          "Deal pipeline",
          "Leads",
          "Organizations and contacts",
          "Activities",
          "Contracts",
          "Targets",
        ],
      },
      {
        name: "Analytics",
        items: ["Profitability", "Sales reports", "ML and predictions"],
      },
      {
        name: "Configuration",
        items: ["Users and permissions", "Pipelines", "Templates", "Automations"],
      },
    ],
    proof:
      "Running today at Evoelution, the first client: 602 tickets · 257 machines · 161 clients · 2,766 hours.",
  },

  gap: {
    eyebrow: "The gap",
    title: "What separated one company from the other had a price tag",
    lede: "It was not an idea, it was an invoice. That is why the gap held for twenty years.",
    meterTitle: "Distance between deciding with data and deciding without",
    small: "small company",
    big: "large company",
    label: "gap",
    items: [
      {
        kicker: "It cost",
        title: "A data team",
        body: "Someone who understands the business and can model. A headcount a thirty-person company will not open for a purchasing forecast.",
      },
      {
        kicker: "It cost",
        title: "A data warehouse",
        body: "Extracting data from the operational system, cleaning it and keeping its history. Months of project before the first model.",
      },
      {
        kicker: "And above all",
        title: "History nobody kept",
        body: "The real obstacle. Almost every business system stores today's state and overwrites yesterday's. With no past there is nothing to learn.",
      },
    ],
  },

  now: {
    eyebrow: "Why it works now",
    title: "Because the ERP already has the data. It just needed to remember.",
    lede: "Nobody enters data for a model. They enter it to work: open a ticket, log the hours, consume a part, move a deal along. That is exactly the data a model needs, and it is already being written.",
    items: [
      {
        kicker: "The design decision",
        title: "Keep the history, not just the state",
        body: "Every change is written to a log the database refuses to let anyone rewrite. It is the difference between being able to reconstruct how things stood thirty days ago and not. Without it, a model learns from an outcome it already knows and fails the moment it is used for real.",
      },
      {
        kicker: "What disappears",
        title: "The extraction project",
        body: "This is how a large company decides: pull the data out of the operational system, move it to another layer, process it there and hand back a dashboard. That move is half the cost and all of the delay. In Astraion the decision layer lives inside the same system that produces the data: there is nothing to extract.",
      },
      {
        kicker: "The consequence",
        title: "The model ships with the system",
        body: "No integration to contract, no project to kick off. The company operates as it operates and the system accumulates what is needed. The first useful model does not arrive after a six-month project: it arrives when there is enough history, which is a different thing.",
      },
    ],
  },

  decisions: {
    eyebrow: "What it decides",
    title: 'Concrete decisions, not "intelligence" in the abstract',
    lede: "Each answers a question someone already asks every week — today by gut feel.",
    states: { live: "Running", dev: "In progress", next: "Data ready, no model" },
    rows: [
      {
        q: "How many of each spare part should I buy?",
        src: "Consumption history from the inventory ledger",
        state: "dev" as const,
      },
      {
        q: "Which ticket will miss its due date?",
        src: "History of tickets on the same machine and category",
        state: "dev" as const,
      },
      {
        q: "Which client will not renew their contract?",
        src: "Expiring contracts crossed with the year's activity",
        state: "next" as const,
      },
      {
        q: "Which deal in the pipeline will close?",
        src: "Stage-change events and time spent at each",
        state: "next" as const,
      },
      {
        q: "Which analytical run drifted off pattern?",
        src: "Chromatography · anomaly detection",
        state: "live" as const,
      },
    ],
    disclaimerTitle: "What this does not promise.",
    disclaimer:
      "A model does not guess without history: a company starting from zero needs months of operation before its first forecast is worth anything. Nor does it decide for anyone — it ranks, estimates and flags; the decision still belongs to whoever answers for it. Saying so matters: most of the disillusion with these tools comes from having sold them otherwise.",
  },

  compound: {
    eyebrow: "The compounding effect",
    title: "And one more advantage for the small company: fifty know more than one",
    lede: "Here scale flips. A large company learns only from itself; a small one, inside a platform, can learn from every company that chose to contribute.",
    items: [
      {
        title: "Nobody contributes silently",
        body: "Data contribution starts off and is granted explicitly, with a name and a date attached. It is revocable, and on revocation that company drops out of the next training run. Each client's data lives in its own schema, isolated from the rest.",
      },
      {
        title: "A new client does not start blind",
        body: "That is the deal: predicting a pump failure from one lab's history is thin statistics; from fifty it is a product. The model serves everyone, contributors or not.",
      },
    ],
  },

  signup: {
    eyebrow: "Request access",
    title: "Astraion is not signed up for with one click.",
    lede:
      "Every company that comes in gets its own isolated schema, and that is provisioned by hand for now. Leave your details and we will write back — if the product is not right for you yet, we would rather say so early.",
    fields: {
      company: "Company",
      contact: "Your name",
      email: "Email",
      phone: "Phone (optional)",
      size: "People",
      industry: "Industry (optional)",
      note: "Which decision do you want to stop making from memory?",
    },
    sizes: ["1–10", "11–30", "31–80", "81–200", "200+"],
    industryPlaceholder: "Lab, distribution, manufacturing…",
    notePlaceholder: "How much to buy, who to visit, what is about to break…",
    submit: "Send request",
    sending: "Sending…",
    doneTitle: "Request received.",
    doneBody:
      "It is now in the team's queue. If your company is a fit, you get access with your own space already created.",
    privacy:
      "These details are only used to reply to you. No account is created and no access is granted until someone reviews the request.",
  },

  footer: {
    a: "ERP with Machine Learning for small companies",
    b: "Made in Mexico",
  },
} as const;

export function getCopy(locale: string) {
  return locale === "en" ? en : es;
}
