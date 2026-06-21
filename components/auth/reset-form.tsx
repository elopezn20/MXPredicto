"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPassword } from "@/lib/actions/auth";

interface ResetFormProps {
  locale: string;
  tokenHash?: string;
  t: {
    newPassword: string;
    confirmPassword: string;
    resetPassword: string;
    error: {
      generic: string;
      passwordTooShort: string;
      passwordsMustMatch: string;
      linkExpired: string;
    };
  };
}

export function ResetForm({ locale, tokenHash, t }: ResetFormProps) {
  const [state, formAction, pending] = useActionState(resetPassword, null);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      {tokenHash && <input type="hidden" name="tokenHash" value={tokenHash} />}

      {state && !state.ok && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error === "error.passwordTooShort"
            ? t.error.passwordTooShort
            : state.error === "error.passwordsMustMatch"
              ? t.error.passwordsMustMatch
              : state.error === "error.linkExpired"
                ? t.error.linkExpired
                : t.error.generic}
        </p>
      )}

      <div className="space-y-1">
        <Label htmlFor="password">{t.newPassword}</Label>
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
        {pending ? "…" : t.resetPassword}
      </Button>
    </form>
  );
}
