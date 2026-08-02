import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getCopy } from "@/components/astraion/copy";
import { Starfield } from "@/components/astraion/starfield";
import { GapMeter } from "@/components/astraion/gap-meter";
import { DecisionForecast } from "@/components/astraion/decision-forecast";
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
      ? "Small companies don't decide worse. They decide with less. An ERP that keeps its history so the models can ride along."
      : "La empresa chica no decide peor: decide con menos. Un ERP que guarda su historia para que los modelos viajen con él.",
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
              <Link href="/evoelution" className={s.linkGhost}>
                {t.nav.caso}
              </Link>
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
                {t.hero.title1}
                <br />
                <em>{t.hero.title2}</em>
              </h1>

              <p className={s.lede}>{t.hero.lede}</p>
            </div>

            {/* El titular dice que una empresa grande responde con un
                pronóstico. Aquí está ese pronóstico: dato del ERP, modelo y
                decisión en un solo objeto. */}
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
                labels={{
                  history: t.forecast.history,
                  model: t.forecast.model,
                  today: t.forecast.today,
                }}
              />

              <div className={s.fcastReadout}>
                <span className={s.label}>{t.forecast.readoutLabel}</span>
                <span className={s.value}>{t.forecast.readoutValue}</span>
                <span className={s.unit}>{t.forecast.readoutUnit}</span>
              </div>

              <figcaption className={s.fcastFoot}>{t.forecast.foot}</figcaption>
            </figure>
          </div>

          <div className={s.spectrum} role="img" aria-label={t.hero.spectrumNote} />
          <div className={s.spectrumKey}>
            <span>
              <b>486 nm</b> Hβ
            </span>
            <span>
              <b>500 nm</b> O III
            </span>
            <span>
              <b>589 nm</b> Na
            </span>
            <span>
              <b>656 nm</b> H-α
            </span>
          </div>

          <p className={s.ledeSm}>
            {t.hero.spectrumNote} <strong>{t.hero.spectrumStrong}</strong>
          </p>

          {/* La tesis como objeto: misma pregunta, dos respuestas */}
          <div className={s.duel}>
            <div className={s.duelQ}>
              {t.duel.question}
              <span>{t.duel.caption}</span>
            </div>
            <div className={s.duelRows}>
              <div className={s.duelCell}>
                <span className={s.who}>{t.duel.big.who}</span>
                <span className={s.ansBig}>{t.duel.big.answer}</span>
                <span className={s.how}>{t.duel.big.how}</span>
              </div>
              <div className={s.duelCell}>
                <span className={s.who}>{t.duel.small.who}</span>
                <span className={s.ansSmall}>{t.duel.small.answer}</span>
                <span className={s.how}>{t.duel.small.how}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

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

      {/* ---------------- Estado ---------------- */}
      <section className={s.section}>
        <div className={s.wrap}>
          <p className={s.eyebrow}>{t.status.eyebrow}</p>
          <h2 className={s.closingTitle} style={{ marginTop: 18 }}>
            {t.status.title1}
            <br />
            <em>{t.status.title2}</em>
          </h2>

          {/* El caso: quién es Evoelution y por qué sus cifras son reales */}
          <article className={s.caseCard}>
            <p className={s.kicker}>{t.status.caseKicker}</p>
            <h3>{t.status.caseTitle}</h3>
            <p>{t.status.caseBody}</p>
          </article>

          <div className={s.figures}>
            {t.status.figures.map((f) => (
              <div key={f.l} className={s.fig}>
                <span className={s.figN}>{f.n}</span>
                <span className={s.figL}>{f.l}</span>
              </div>
            ))}
          </div>

          <div className={s.note}>
            <p>{t.status.closing}</p>
          </div>
        </div>
      </section>

      <footer className={s.wrap}>
        <div className={s.footer}>
          <span>{t.footer.a}</span>
          <span>{t.footer.b}</span>
          <Link href="/login">{t.nav.entrar}</Link>
        </div>
      </footer>
    </div>
  );
}
