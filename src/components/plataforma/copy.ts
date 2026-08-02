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
  brand: "Evoelution · iniciativa",
  nav: { producto: "Ver la plataforma", entrar: "Entrar" },

  hero: {
    eyebrow: "ERP + Machine Learning",
    title1: "La empresa chica no decide peor.",
    title2: "Decide con menos.",
    lede:
      "La brecha con las grandes nunca fue de talento ni de ambición. Fue de infraestructura: equipos de datos, almacenes, ingenieros de modelos. Cosas que se pagan con una nómina que una empresa de treinta personas no tiene. Esta iniciativa parte de que esa brecha ya se puede cerrar.",
    spectrumNote:
      "Un astrónomo sabe de qué está hecha una estrella leyendo sus líneas de emisión. Un cromatógrafo identifica un compuesto por su pico de retención. Es el mismo gesto: medir una señal para saber qué hay dentro.",
    spectrumStrong: "Esta plataforma hace eso con la operación de una empresa.",
  },

  duel: {
    question: "«¿Cuántas bombas de HPLC compro este trimestre?»",
    caption: "La misma pregunta, dos empresas.",
    big: {
      who: "Empresa grande",
      answer: "Un pronóstico",
      how: "Consumo histórico por número de parte, estacionalidad, tiempo de entrega del proveedor. Un modelo lo calcula; alguien lo revisa.",
    },
    small: {
      who: "Empresa chica — hasta hoy",
      answer: "Una corazonada",
      how: "«El año pasado se acabaron en marzo.» El dato existía, en tickets y notas de servicio. Nunca hubo quién lo convirtiera en decisión.",
    },
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

  status: {
    eyebrow: "Dónde está hoy",
    title1: "El ERP ya opera.",
    title2: "Los modelos vienen detrás de la historia.",
    figures: [
      { n: "602", l: "Tickets" },
      { n: "257", l: "Equipos" },
      { n: "161", l: "Clientes" },
      { n: "2 766", l: "Horas de servicio" },
    ],
    closing:
      "Para una empresa de treinta personas, cerrar la brecha no significa tener el equipo de datos de una corporación. Significa que la pregunta de los lunes —cuánto compro, a quién visito, qué se me va a caer— deje de responderse de memoria.",
  },

  footer: {
    a: "Evoelution · ERP con Machine Learning",
    b: "Iniciativa en curso",
  },
} as const;

const en = {
  brand: "Evoelution · initiative",
  nav: { producto: "See the platform", entrar: "Sign in" },

  hero: {
    eyebrow: "ERP + Machine Learning",
    title1: "Small companies don't decide worse.",
    title2: "They decide with less.",
    lede:
      "The gap with large companies was never about talent or ambition. It was infrastructure: data teams, warehouses, ML engineers — things paid for with a payroll a thirty-person company does not have. This initiative starts from the fact that the gap can now be closed.",
    spectrumNote:
      "An astronomer knows what a star is made of by reading its emission lines. A chromatographer identifies a compound by its retention peak. Same gesture: measure a signal to learn what is inside.",
    spectrumStrong: "This platform does that with a company's operation.",
  },

  duel: {
    question: '"How many HPLC pumps should I buy this quarter?"',
    caption: "Same question, two companies.",
    big: {
      who: "Large company",
      answer: "A forecast",
      how: "Historical consumption per part number, seasonality, supplier lead time. A model computes it; someone reviews it.",
    },
    small: {
      who: "Small company — until now",
      answer: "A hunch",
      how: '"We ran out last March." The data existed, in tickets and service notes. There was never anyone to turn it into a decision.',
    },
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

  status: {
    eyebrow: "Where it stands today",
    title1: "The ERP is running.",
    title2: "The models follow the history.",
    figures: [
      { n: "602", l: "Tickets" },
      { n: "257", l: "Machines" },
      { n: "161", l: "Clients" },
      { n: "2,766", l: "Service hours" },
    ],
    closing:
      "For a thirty-person company, closing the gap does not mean having a corporation's data team. It means the Monday question — how much to buy, who to visit, what is about to break — stops being answered from memory.",
  },

  footer: {
    a: "Evoelution · ERP with Machine Learning",
    b: "Initiative in progress",
  },
} as const;

export function getCopy(locale: string) {
  return locale === "en" ? en : es;
}
