import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getCopy } from "@/components/astraion/copy";
import { Starfield } from "@/components/astraion/starfield";
import { GapMeter } from "@/components/astraion/gap-meter";
import { DecisionForecast } from "@/components/astraion/decision-forecast";
import { LayerDeck, LayerRows } from "@/components/astraion/layer-stack";
import { SignupForm } from "@/components/astraion/signup-form";
import s from "./astraion.module.css";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const en = locale === "en";
  return {
    // `absolute` ignora la plantilla del layout raíz: el título ya dice
    // Astraion y repetirlo daría "Astraion — … · Astraion".
    title: {
      absolute: en
        ? "Astraion — ERP with Machine Learning for small companies"
        : "Astraion — ERP con Machine Learning para empresas pequeñas",
    },
    description: en
      ? "The first ERP with machine learning inside: three layers in one system — data, history and intelligence. Not an AI module bolted on."
      : "El primer ERP con machine learning adentro: tres capas en un solo sistema —datos, historia e inteligencia—. No un módulo de IA colgado encima.",
  };
}

/**
 * Página de la iniciativa.
 *
 * Combina el mensaje —cerrar la brecha de decisión entre empresas chicas y
 * grandes— con el mundo visual del cielo profundo: un astrónomo lee líneas de
 * emisión para saber de qué está hecha una estrella, un cromatógrafo lee picos
 * de retención para identificar un compuesto. La plataforma hace lo mismo con
 * la operación de una empresa.
 */
export default async function PlataformaPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = getCopy(locale);

  const pillClass = { live: s.pillLive, dev: s.pillDev, next: s.pillNext } as const;

  return (
    <div className={s.page}>
      {/* ---------------- Cielo + tesis ---------------- */}
      <header className={s.sky}>
        <Starfield className={s.stars} />
        <div className={s.veil} aria-hidden="true" />

        <div className={s.wrap}>
          <nav className={s.top}>
            <div className={s.brand}>
              <span className={s.brandDot} aria-hidden="true" />
              <span className={s.brandName}>{t.brand}</span>
            </div>
            <div className={s.topLinks}>
              {/* Anclas a las secciones que ya existen. Se ocultan en pantallas
                  estrechas: con cinco elementos la barra se parte en dos filas
                  y deja de leerse como una barra. */}
              <a href="#capas" className={`${s.linkGhost} ${s.navAnchor}`}>
                {t.nav.arquitectura}
              </a>
              <a href="#modulos" className={`${s.linkGhost} ${s.navAnchor}`}>
                {t.nav.modulos}
              </a>
              <Link href="/evoelution" className={s.linkGhost}>
                {t.nav.caso}
              </Link>
              {/* Ancla, no ruta: la solicitud vive en esta misma página y
                  mandarla a otra perdería el contexto que la justifica. */}
              <a href="#acceso" className={s.linkGhost}>
                {t.nav.acceso}
              </a>
              <Link href="/login" className={s.linkSolid}>
                {t.nav.entrar}
              </Link>
            </div>
          </nav>
        </div>

        <div className={`${s.wrap} ${s.heroInner}`}>
          <div className={s.heroGrid}>
            <div className={s.heroCol}>
              <p className={s.eyebrow}>{t.hero.eyebrow}</p>

              <h1 className={s.heroTitle}>
                {t.hero.h1a} <em>{t.hero.h1em}</em> {t.hero.h1b}
              </h1>

              <p className={s.claim}>{t.hero.claim}</p>
            </div>

            {/* El titular dice «tres capas en un solo sistema». Aquí están:
                llegan separadas y se ensamblan. Es la arquitectura, y por eso
                ocupa el encabezado y no un lugar más abajo. */}
            <LayerDeck styles={s} layers={t.layers.stack} />
          </div>

        </div>
      </header>

      {/* ---------------- Las tres capas ---------------- */}
      <section className={s.section} id="capas">
        <div className={s.wrap}>
          <div className={s.secHead}>
            <p className={s.eyebrow}>{t.layers.eyebrow}</p>
            <h2>{t.layers.title}</h2>
            <p>{t.layers.lede}</p>
          </div>

          <div className={s.archSplit}>
            {/* El pronóstico es la prueba de la capa 3: dato del ERP, modelo y
                decisión en un solo objeto. Va junto a las capas, no suelto. */}
            <figure className={s.fcast}>
              <div className={s.fcastHead}>
                <p className={s.fcastTitle}>
                  {t.forecast.title}
                  <span className={s.fcastPart}>{t.forecast.part}</span>
                </p>
                <span className={s.fcastTag}>{t.forecast.tag}</span>
              </div>

              <DecisionForecast
                className={s.fcastCanvas}
                locale={locale}
                labels={{ today: t.forecast.today, unit: t.forecast.unit }}
              />

              <ul className={s.fcastKey}>
                <li className={s.keyHist}>
                  <i aria-hidden="true" />
                  {t.forecast.history}
                </li>
                <li className={s.keyModel}>
                  <i aria-hidden="true" />
                  {t.forecast.model}
                </li>
                <li className={s.keyBand}>
                  <i aria-hidden="true" />
                  {t.forecast.band}
                </li>
              </ul>

              <div className={s.fcastReadout}>
                <span className={s.label}>{t.forecast.readoutLabel}</span>
                <span className={s.value}>{t.forecast.readoutValue}</span>
                <span className={s.unit}>{t.forecast.readoutUnit}</span>
              </div>

              <figcaption className={s.fcastFoot}>{t.forecast.foot}</figcaption>
            </figure>

            <LayerRows
              styles={s}
              layers={t.layers.stack}
              ceiling={t.layers.ceiling}
            />
          </div>
        </div>
      </section>

      {/* ---------------- Módulos ---------------- */}
      <section className={s.section} id="modulos">
        <div className={s.wrap}>
          <div className={s.secHead}>
            <p className={s.eyebrow}>{t.modules.eyebrow}</p>
            <h2>{t.modules.title}</h2>
            <p>{t.modules.lede}</p>
          </div>

          <div className={s.mods}>
            {t.modules.groups.map((g) => (
              <article key={g.name} className={s.mod}>
                <h3 className={s.modName}>{g.name}</h3>
                <ul className={s.modList}>
                  {g.items.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>

          <div className={s.note} style={{ marginTop: 24 }}>
            <p>{t.modules.proof}</p>
          </div>
        </div>
      </section>

      {/* ---------------- La brecha ---------------- */}
      <section className={s.section}>
        <div className={s.wrap}>
          <div className={s.secHead}>
            <p className={s.eyebrow}>{t.gap.eyebrow}</p>
            <h2>{t.gap.title}</h2>
            <p>{t.gap.lede}</p>
          </div>

          <div className={s.meter}>
            <h3>{t.gap.meterTitle}</h3>
            <GapMeter
              styles={s}
              labels={{ small: t.gap.small, big: t.gap.big, gap: t.gap.label }}
            />
          </div>

          <div className={s.grid3}>
            {t.gap.items.map((it) => (
              <article key={it.title} className={s.card}>
                <p className={s.kicker}>{it.kicker}</p>
                <h3>{it.title}</h3>
                <p>{it.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- Por qué ahora ---------------- */}
      <section className={s.section}>
        <div className={s.wrap}>
          <div className={s.secHead}>
            <p className={s.eyebrow}>{t.now.eyebrow}</p>
            <h2>{t.now.title}</h2>
            <p>{t.now.lede}</p>
          </div>
          <div className={s.grid2}>
            {t.now.items.map((it) => (
              <article key={it.title} className={s.card}>
                <p className={s.kicker}>{it.kicker}</p>
                <h3>{it.title}</h3>
                <p>{it.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- Qué decide ---------------- */}
      <section className={s.section}>
        <div className={s.wrap}>
          <div className={s.secHead}>
            <p className={s.eyebrow}>{t.decisions.eyebrow}</p>
            <h2>{t.decisions.title}</h2>
            <p>{t.decisions.lede}</p>
          </div>

          <div className={s.reads}>
            {t.decisions.rows.map((r) => (
              <div key={r.q} className={s.read}>
                <span className={s.readQ}>{r.q}</span>
                <span className={s.readSrc}>{r.src}</span>
                <span className={`${s.pill} ${pillClass[r.state]}`}>
                  {t.decisions.states[r.state]}
                </span>
              </div>
            ))}
          </div>

          <div className={s.note} style={{ marginTop: 24 }}>
            <p>
              <strong>{t.decisions.disclaimerTitle}</strong>{" "}
              {t.decisions.disclaimer}
            </p>
          </div>
        </div>
      </section>

      {/* ---------------- Efecto compuesto ---------------- */}
      <section className={s.section}>
        <div className={s.wrap}>
          <div className={s.secHead}>
            <p className={s.eyebrow}>{t.compound.eyebrow}</p>
            <h2>{t.compound.title}</h2>
            <p>{t.compound.lede}</p>
          </div>
          <div className={s.grid2}>
            {t.compound.items.map((it) => (
              <article key={it.title} className={s.card}>
                <h3>{it.title}</h3>
                <p>{it.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- Solicitud de acceso ---------------- */}
      <section className={s.section} id="acceso">
        <div className={s.wrap}>
          <div className={s.secHead}>
            <p className={s.eyebrow}>{t.signup.eyebrow}</p>
            <h2>{t.signup.title}</h2>
            <p>{t.signup.lede}</p>
          </div>
          <SignupForm locale={locale} />
        </div>
      </section>

      <footer className={s.footerWrap}>
        <div className={s.wrap}>
          <div className={s.footer}>
            <div className={s.brand}>
              <span className={s.brandDot} aria-hidden="true" />
              <span className={s.brandName}>{t.brand}</span>
            </div>

            <nav className={s.footerNav}>
              <a href="#capas">{t.nav.arquitectura}</a>
              <a href="#modulos">{t.nav.modulos}</a>
              <Link href="/evoelution">{t.nav.caso}</Link>
              <a href="#acceso">{t.nav.acceso}</a>
              <Link href="/login">{t.nav.entrar}</Link>
            </nav>
          </div>

          <p className={s.footerNote}>
            {t.footer.a} · {t.footer.b}
          </p>
        </div>
      </footer>
    </div>
  );
}
