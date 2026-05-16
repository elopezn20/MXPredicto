import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth/auth-card";
import { ForgotForm } from "@/components/auth/forgot-form";

interface Props {
  params: Promise<{ locale: string }>;
}

export default async function ForgotPasswordPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations("auth");

  return (
    <AuthCard title={t("forgotPassword")}>
      <ForgotForm
        locale={locale}
        t={{
          email: t("email"),
          sendResetLink: t("sendResetLink"),
          checkEmail: t("checkEmail"),
          backToLogin: t("backToLogin"),
          error: { generic: t("error.generic") },
        }}
      />
    </AuthCard>
  );
}
