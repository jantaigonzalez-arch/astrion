"use server";

import { z } from "zod";
import { isDbConfigured } from "@/lib/db";
import { tenantDb } from "@/lib/tenancy/context";
import { leads } from "@/lib/db/schema";

const LeadSchema = z.object({
  name: z.string().min(2).max(160),
  email: z.string().email().max(255),
  company: z.string().max(200).optional(),
  message: z.string().min(5).max(2000),
});

export type LeadFormState = {
  ok: boolean;
  error?: string;
};

export async function submitLead(
  _prev: LeadFormState,
  formData: FormData,
): Promise<LeadFormState> {
  const parsed = LeadSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    company: formData.get("company") || undefined,
    message: formData.get("message"),
  });

  if (!parsed.success) {
    return { ok: false, error: "invalid" };
  }

  // Sin DB: aceptamos el lead (degradación elegante) hasta configurar Postgres.
  if (!isDbConfigured) {
    console.info("[lead] recibido (sin DB):", parsed.data.email);
    return { ok: true };
  }

  try {
    const db = await tenantDb();
    await db.insert(leads).values({
      name: parsed.data.name,
      email: parsed.data.email.toLowerCase(),
      company: parsed.data.company,
      message: parsed.data.message,
      source: "web_contact",
    });
    return { ok: true };
  } catch (e) {
    console.error("[lead] error al persistir:", e);
    return { ok: false, error: "server" };
  }
}
