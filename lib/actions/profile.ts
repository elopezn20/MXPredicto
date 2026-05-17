"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const LocaleSchema = z.enum(["en", "es", "ko"]);

export async function updatePreferredLocale(locale: string): Promise<void> {
  const parsed = LocaleSchema.safeParse(locale);
  if (!parsed.success) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("profiles")
    .update({ preferred_locale: parsed.data })
    .eq("id", user.id);
}
