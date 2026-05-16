"use client";

import { logout } from "@/lib/actions/auth";

export function LogoutButton({
  locale,
  label,
}: {
  locale: string;
  label: string;
}) {
  const action = logout.bind(null, locale);
  return (
    <form action={action}>
      <button
        type="submit"
        className="text-sm text-white/70 transition-colors hover:text-white"
      >
        {label}
      </button>
    </form>
  );
}
