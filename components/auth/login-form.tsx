"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login } from "@/lib/actions/auth";
import Link from "next/link";

interface LoginFormProps {
  locale: string;
  t: {
    email: string;
    password: string;
    login: string;
    forgotPassword: string;
    error: { invalidCredentials: string };
  };
}

export function LoginForm({ locale, t }: LoginFormProps) {
  const [state, formAction, pending] = useActionState(login, null);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />

      {state && !state.ok && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {t.error.invalidCredentials}
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

      <div className="space-y-1">
        <Label htmlFor="password">{t.password}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "…" : t.login}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        <Link
          href={`/${locale}/forgot-password`}
          className="underline underline-offset-4 hover:text-foreground"
        >
          {t.forgotPassword}
        </Link>
      </p>
    </form>
  );
}
