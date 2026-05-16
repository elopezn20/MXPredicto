"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signupWithToken } from "@/lib/actions/auth";

interface SignupFormProps {
  locale: string;
  token: string;
  email: string;
  t: {
    displayName: string;
    email: string;
    password: string;
    confirmPassword: string;
    signup: string;
    error: {
      generic: string;
      emailInUse: string;
      passwordsMustMatch: string;
      passwordTooShort: string;
    };
    invalidToken: string;
    tokenExpired: string;
  };
}

export function SignupForm({ locale, token, email, t }: SignupFormProps) {
  const [state, formAction, pending] = useActionState(signupWithToken, null);

  function errorMessage(key: string) {
    if (key === "error.emailInUse") return t.error.emailInUse;
    if (key === "error.passwordTooShort") return t.error.passwordTooShort;
    if (key === "invalidToken") return t.invalidToken;
    if (key === "tokenExpired") return t.tokenExpired;
    return t.error.generic;
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="token" value={token} />

      {state && !state.ok && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errorMessage(state.error)}
        </p>
      )}

      <div className="space-y-1">
        <Label htmlFor="email">{t.email}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          defaultValue={email}
          readOnly
          className="bg-muted"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="displayName">{t.displayName}</Label>
        <Input
          id="displayName"
          name="displayName"
          type="text"
          autoComplete="name"
          required
          minLength={1}
          maxLength={50}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="password">{t.password}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="confirmPassword">{t.confirmPassword}</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
        />
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "…" : t.signup}
      </Button>
    </form>
  );
}
