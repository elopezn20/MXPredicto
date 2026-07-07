import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ user?: string }>;
}

// Player stats now live on the profile page. Keep this route as a redirect so
// old links (including ?user= deep links) still work.
export default async function ProgressPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { user: userParam } = await searchParams;

  if (userParam) redirect(`/${locale}/profile/${userParam}`);

  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (authUser) redirect(`/${locale}/profile/${authUser.id}`);
  redirect(`/${locale}/scoreboard`);
}
