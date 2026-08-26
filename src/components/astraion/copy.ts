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
    // La audiencia vivía en el titular («para una PYME») y se perdió al
    // reescribirlo en lenguaje llano. Vuelve aquí, que es donde no le quita
    // sitio a la idea y sigue siendo lo primero que se lee.
    eyebrow: "ERP + Machine Learning · para pequeñas y medianas empresas",
    /*
      El titular dice qué es y para quién. Es lo único que abre la página: la
      tesis («una pyme no decide peor…») y el duelo de las dos respuestas
      vivían aquí y se retiraron.

      Decía «El primer ERP con machine learning adentro para una PYME», y el
      problema no era la frase sino la primera palabra: ERP. Quien no sabe qué
      significa —que es justo el dueño de la empresa pequeña al que va dirigida
      la página— se quedaba sin entender el titular, y un titular que hay que
      buscar en Google no es un titular.

      Ahora el titular no usa una sola palabra técnica y el término aparece
      DEFINIDO en la línea de abajo, en el sitio donde ya se entendió la idea.
      El orden importa: primero qué es, después cómo se llama. Al revés no
      funciona, porque nadie retiene la definición de algo que todavía no sabe
      para qué sirve.

      El término no se borra: es lo que busca quien sí lo conoce, sigue en el
      antetítulo y en el <title> de la página.
    */
    h1a: "Todo tu negocio en un sistema",
    h1em: "que aprende de él",
    h1b: "y te dice qué sigue",
    claim:
      "Servicio, ventas, clientes, inventario y compras en el mismo lugar —a eso se le llama ERP—. El nuestro es el primero que trae machine learning adentro, no un módulo de IA colgado encima.",
  },

  /*
    El producto, enseñado.

    La página argumentaba muy bien y no enseñaba una sola pantalla. Va justo
    después del titular a propósito: la afirmación de arriba —«todo tu negocio
    en un sistema»— se comprueba antes de pedirle a nadie que lea sobre capas.

    Las cifras y por qué unas son reales y otras no: ver `panel-preview.tsx`.
  */
  product: {
    eyebrow: "El producto",
    title: "La operación completa, en una sola pantalla",
    lede: "Lo que hay que atender, lo que está vendido, lo que se debe. Y al lado, lo que el sistema mide — y lo que estima, que es lo único de aquí que un ERP tradicional no puede hacer.",
    shot: {
      /*
        El panel lleva la marca de QUIEN LEE, no la de un cliente.

        Decía «Evoelution» y esa es la primera empresa que usa el sistema, no
        la audiencia de esta página: verla ahí hacía que la portada de Astraion
        pareciera ser sobre otra compañía. Un nombre de relleno dice lo mismo
        sin regalarle el escaparate a nadie, y de paso el lector se ve a sí
        mismo dentro del producto.

        El caso Evoelution sigue existiendo — tiene su enlace en la barra y su
        línea de prueba con las cifras. Lo que no hace es firmar la lámina.
      */
      url: "tu-empresa.astraion.com/panel",
      brand: "Tu empresa",
      mark: "T",
      nav: [
        "Panel",
        "Servicio",
        "Ventas",
        "Clientes",
        "Inventario",
        "Compras",
        "Análisis",
        "Inteligencia",
      ],
      powered: "Powered by Astraion",
      hi: "Hola, Ana",
      sub: "La empresa entera, al entrar.",
      areas: {
        servicio: "Servicio",
        ventas: "Ventas",
        clientes: "Clientes",
        inventario: "Inventario",
        compras: "Compras",
      },
      figures: {
        tickets: "Tickets",
        abiertos: "Abiertos",
        sinAsignar: "Sin asignar",
        enJuego: "En juego",
        ganados: "Ganados",
        clientes: "Clientes",
        contratos: "Contratos",
        porVencer: "Por vencer",
        refacciones: "Refacciones",
        sinExistencia: "Sin existencia",
        ordenes: "Órdenes",
        porPagar: "Por pagar",
      },
      listTitle: "Tickets recientes",
      listMore: "Ver todos",
      subjects: [
        "La pantalla del equipo parpadea al encender",
        "Sin reproducibilidad en el detector de fluorescencia",
        "Mantenimiento preventivo y cambio de fuentes",
        "Mantenimiento preventivo anual",
      ],
      states: { open: "Abierto", wait: "En espera", done: "Cerrado" },
      caption:
        "El panel de una empresa al entrar. Las cifras de Servicio y Clientes son las de una empresa real en operación; las de Ventas, Inventario y Compras son de ejemplo, porque esos módulos ya existen y esa empresa todavía no los usa.",
    },
    board: {
      tag: "Tablero",
      title: "Carga por técnico",
      note: "630 servicios repartidos entre seis técnicos; se enseñan los cuatro con más carga. Sale de los mismos tickets del panel.",
      foot: "Uno de los 38 análisis del catálogo. Se coloca eligiéndolo de una lista, y ninguno pide capturar un dato nuevo: todos leen lo que la operación ya dejó escrito.",
    },
    /*
      La capa 3, con tarjeta propia.

      El tablero de al lado DESCRIBE lo que pasó; esto ESTIMA lo que viene, y
      es lo único de toda la página que un ERP tradicional no puede hacer. Sin
      esta tarjeta el producto se veía completo y corriente: cinco áreas y unas
      barras es lo que enseña cualquier sistema de gestión.

      Lleva banda y casos porque el tipo `ForecastBlock` del producto obliga a
      llevarlos, y la razón es la misma aquí: un número sin banda invita a
      creerle de más.
    */
    smart: {
      tag: "Inteligencia",
      title: "Carga del mes que viene",
      value: "214",
      unit: "horas de servicio",
      low: "186",
      high: "248",
      support: "24 meses de historia",
      model: "servicio · v3",
      foot: "Lo que estima el modelo, con la banda en la que se mueve y los casos que la sostienen. Sale del histórico del propio sistema: nadie captura un dato aparte para que esto exista.",
    },
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
    title: "El sistema completo",
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
      "Corriendo hoy en Evoelution, el primer cliente: 633 tickets · 97 equipos · 161 clientes · 3 032 horas.",
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
    eyebrow: "ERP + Machine Learning · for small and medium businesses",
    // Ver la nota del titular en español: primero qué es, después cómo se llama.
    h1a: "Your whole business in one system",
    h1em: "that learns from it",
    h1b: "and tells you what comes next",
    claim:
      "Service, sales, clients, inventory and purchasing in the same place — that is what an ERP is. Ours is the first one with machine learning inside, not an AI module bolted on top.",
  },

  product: {
    eyebrow: "The product",
    title: "The whole operation, on a single screen",
    lede: "What needs attention, what has been sold, what is owed. And next to it, what the system measures — and what it estimates, the one thing here a traditional ERP cannot do.",
    shot: {
      url: "your-company.astraion.com/panel",
      brand: "Your company",
      mark: "Y",
      nav: [
        "Panel",
        "Service",
        "Sales",
        "Clients",
        "Inventory",
        "Purchasing",
        "Analysis",
        "Intelligence",
      ],
      powered: "Powered by Astraion",
      hi: "Hi, Ana",
      sub: "The whole company, on arrival.",
      areas: {
        servicio: "Service",
        ventas: "Sales",
        clientes: "Clients",
        inventario: "Inventory",
        compras: "Purchasing",
      },
      figures: {
        tickets: "Tickets",
        abiertos: "Open",
        sinAsignar: "Unassigned",
        enJuego: "In play",
        ganados: "Won",
        clientes: "Clients",
        contratos: "Contracts",
        porVencer: "Expiring",
        refacciones: "Parts",
        sinExistencia: "Out of stock",
        ordenes: "Orders",
        porPagar: "Payable",
      },
      listTitle: "Recent tickets",
      listMore: "See all",
      subjects: [
        "The instrument display flickers on start-up",
        "No reproducibility on the fluorescence detector",
        "Preventive maintenance and power supply swap",
        "Annual preventive maintenance",
      ],
      states: { open: "Open", wait: "Waiting", done: "Closed" },
      caption:
        "A company's panel on arrival. The Service and Clients figures come from a real company in operation; Sales, Inventory and Purchasing are an example, because those modules already exist and that company is not using them yet.",
    },
    board: {
      tag: "Board",
      title: "Load per technician",
      note: "630 service calls across six technicians; the four with the heaviest load are shown. It comes from the same tickets in the panel.",
      foot: "One of the 38 analyses in the catalogue. You place it by picking it from a list, and none of them asks for a new field: they all read what the operation already wrote down.",
    },
    smart: {
      tag: "Intelligence",
      title: "Next month's load",
      value: "214",
      unit: "service hours",
      low: "186",
      high: "248",
      support: "24 months of history",
      model: "service · v3",
      foot: "What the model estimates, with the band it moves in and the cases that hold it up. It comes from the system's own history: nobody keys in anything extra for this to exist.",
    },
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
    title: "The complete system",
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
      "Running today at Evoelution, the first client: 633 tickets · 97 machines · 161 clients · 3,032 hours.",
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
