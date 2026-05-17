import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

interface Props {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function AdminLayout({ children, params }: Props) {
  const { locale } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`/${locale}/login`);

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!profile?.is_admin) redirect(`/${locale}/predictions`);

  return <>{children}</>;
}
