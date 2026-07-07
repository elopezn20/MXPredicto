"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";

interface Option {
  id: string;
  displayName: string;
}

interface Props {
  users: Option[];
  selectedId: string;
  label: string;
  /** When set, selecting navigates to `${basePath}/<id>` instead of `?user=<id>`. */
  basePath?: string;
}

export function UserSelect({ users, selectedId, label, basePath }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (basePath) {
      startTransition(() => {
        router.push(`${basePath}/${e.target.value}`);
      });
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("user", e.target.value);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <label className="flex flex-col gap-1 text-sm sm:max-w-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      <select
        value={selectedId}
        onChange={onChange}
        disabled={pending}
        className="rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
      >
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.displayName}
          </option>
        ))}
      </select>
    </label>
  );
}
