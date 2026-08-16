"use client";

import { useActionState } from "react";
import { requestSignup, type SignupState } from "@/lib/actions/signup";
import { getCopy } from "@/components/astraion/copy";
import s from "./signup.module.css";

/**
 * Solicitud de acceso desde la web pública.
 *
 * Deliberadamente NO es un registro: no crea cuenta, no manda a un panel, no
 * promete acceso. Cada inquilino cuesta un esquema de Postgres aprovisionado a
 * mano, y el formulario lo dice en vez de simular un alta instantánea que
 * después habría que desmentir por correo.
 */

const initial: SignupState = { ok: false };

export function SignupForm({ locale }: { locale: string }) {
  const t = getCopy(locale).signup;
  const [state, action, pending] = useActionState(requestSignup, initial);

  if (state.ok) {
    return (
      <div className={s.done}>
        <h3>{t.doneTitle}</h3>
        <p>{t.doneBody}</p>
      </div>
    );
  }

  const bad = (k: string) => (state.fields?.[k] ? s.bad : "");

  return (
    <form action={action} className={s.form} noValidate>
      <input type="hidden" name="locale" value={locale} />

      {/* Trampa de robots: una persona nunca la ve ni la llena. */}
      <div className={s.trap} aria-hidden="true">
        <label htmlFor="website">No llenar</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <div className={s.field}>
        <label className={s.label} htmlFor="companyName">
          {t.fields.company}
        </label>
        <input
          id="companyName"
          name="companyName"
          required
          maxLength={160}
          className={`${s.input} ${bad("companyName")}`}
          autoComplete="organization"
        />
        {state.fields?.companyName && (
          <span className={s.err}>{state.fields.companyName}</span>
        )}
      </div>

      <div className={s.field}>
        <label className={s.label} htmlFor="contactName">
          {t.fields.contact}
        </label>
        <input
          id="contactName"
          name="contactName"
          required
          maxLength={160}
          className={`${s.input} ${bad("contactName")}`}
          autoComplete="name"
        />
        {state.fields?.contactName && (
          <span className={s.err}>{state.fields.contactName}</span>
        )}
      </div>

      <div className={s.field}>
        <label className={s.label} htmlFor="email">
          {t.fields.email}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          maxLength={255}
          className={`${s.input} ${bad("email")}`}
          autoComplete="email"
        />
        {state.fields?.email && <span className={s.err}>{state.fields.email}</span>}
      </div>

      <div className={s.field}>
        <label className={s.label} htmlFor="phone">
          {t.fields.phone}
        </label>
        <input
          id="phone"
          name="phone"
          maxLength={40}
          className={s.input}
          autoComplete="tel"
        />
      </div>

      <div className={s.field}>
        <label className={s.label} htmlFor="size">
          {t.fields.size}
        </label>
        <select id="size" name="size" className={s.select} defaultValue="">
          <option value="">—</option>
          {t.sizes.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      <div className={s.field}>
        <label className={s.label} htmlFor="industry">
          {t.fields.industry}
        </label>
        <input
          id="industry"
          name="industry"
          maxLength={120}
          className={s.input}
          placeholder={t.industryPlaceholder}
        />
      </div>

      <div className={`${s.field} ${s.wide}`}>
        <label className={s.label} htmlFor="note">
          {t.fields.note}
        </label>
        <textarea
          id="note"
          name="note"
          rows={3}
          maxLength={2000}
          className={s.textarea}
          placeholder={t.notePlaceholder}
        />
      </div>

      {state.error && <p className={s.formErr}>{state.error}</p>}

      <div className={s.foot}>
        <p className={s.privacy}>{t.privacy}</p>
        <button type="submit" className={s.submit} disabled={pending}>
          {pending && <span className={s.spin} aria-hidden="true" />}
          {pending ? t.sending : t.submit}
        </button>
      </div>
    </form>
  );
}
