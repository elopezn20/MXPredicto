import { useTranslations } from "next-intl";

export default function HomePage() {
  const t = useTranslations("app");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="text-5xl">⚽</span>
        <h1 className="text-4xl font-bold tracking-tight text-primary">
          {t("name")}
        </h1>
        <p className="text-lg text-muted-foreground">{t("tagline")}</p>
      </div>
      <p className="text-sm text-muted-foreground">{t("greeting")}</p>
    </main>
  );
}
