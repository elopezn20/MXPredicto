import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth/auth-card";
import { SignupForm } from "@/components/auth/signup-form";
import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}

export default async function SignupPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { token } = await searchParams;
  const t = await getTranslations("auth");

  if (!token) {
    return (
      <AuthCard title={t("signup")}>
        <p className="text-sm text-muted-foreground">{t("noAccount")}</p>
        <Link
          href={`/${locale}/login`}
          className="mt-4 block text-center text-sm underline underline-offset-4"
        >
          {t("backToLogin")}
        </Link>
      </AuthCard>
    );
  }

  // Validate token server-side before rendering the form
  const admin = createAdminClient();
  const { data: invitation } = await admin
    .from("invitations")
    .select("email, expires_at, accepted_at")
    .eq("token", token)
    .single();

  if (!invitation || invitation.accepted_at) {
    return (
      <AuthCard title={t("signup")}>
        <p className="text-sm text-destructive">{t("invalidToken")}</p>
      </AuthCard>
    );
  }

  if (new Date(invitation.expires_at) < new Date()) {
    return (
      <AuthCard title={t("signup")}>
        <p className="text-sm text-destructive">{t("tokenExpired")}</p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("signup")}>
      <SignupForm
        locale={locale}
        token={token}
        email={invitation.email}
        t={{
          displayName: t("displayName"),
          email: t("email"),
          password: t("password"),
          confirmPassword: t("confirmPassword"),
          signup: t("signup"),
          invalidToken: t("invalidToken"),
          tokenExpired: t("tokenExpired"),
          error: {
            generic: t("error.generic"),
            emailInUse: t("error.emailInUse"),
            passwordsMustMatch: t("error.passwordsMustMatch"),
            passwordTooShort: t("error.passwordTooShort"),
          },
        }}
      />
    </AuthCard>
  );
}
