import { redirect } from "next/navigation";

interface Props {
  params: Promise<{ locale: string }>;
}

export default async function LocaleRootPage({ params }: Props) {
  const { locale } = await params;
  redirect(`/${locale}/predictions`);
}
