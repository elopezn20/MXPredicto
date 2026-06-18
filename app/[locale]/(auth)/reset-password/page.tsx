import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth/auth-card";
import { ResetForm } from "@/components/auth/reset-form";

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token_hash?: string }>;
}

export default async function ResetPasswordPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { token_hash } = await searchParams;
  const t = await getTranslations("auth");

  return (
    <AuthCard title={t("resetPassword")}>
      <ResetForm
        locale={locale}
        tokenHash={token_hash}
        t={{
          newPassword: t("newPassword"),
          confirmPassword: t("confirmPassword"),
          resetPassword: t("resetPassword"),
          error: {
            generic: t("error.generic"),
            passwordTooShort: t("error.passwordTooShort"),
            passwordsMustMatch: t("error.passwordsMustMatch"),
            linkExpired: t("error.linkExpired"),
          },
        }}
      />
    </AuthCard>
  );
}
