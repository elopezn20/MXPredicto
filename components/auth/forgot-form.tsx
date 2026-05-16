"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { forgotPassword } from "@/lib/actions/auth";
import Link from "next/link";

interface ForgotFormProps {
  locale: string;
  t: {
    email: string;
    sendResetLink: string;
    checkEmail: string;
    backToLogin: string;
    error: { generic: string };
  };
}

export function ForgotForm({ locale, t }: ForgotFormProps) {
  const [state, formAction, pending] = useActionState(forgotPassword, null);

  if (state?.ok) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t.checkEmail}</p>
        <Link
          href={`/${locale}/login`}
          className="block text-center text-sm underline underline-offset-4"
        >
          {t.backToLogin}
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />

      {state && !state.ok && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {t.error.generic}
        </p>
      )}

      <div className="space-y-1">
        <Label htmlFor="email">{t.email}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "…" : t.sendResetLink}
      </Button>

      <p className="text-center text-sm">
        <Link
          href={`/${locale}/login`}
          className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          {t.backToLogin}
        </Link>
      </p>
    </form>
  );
}
