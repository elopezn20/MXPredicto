import Link from "next/link";
import Image from "next/image";
import { LocaleSwitcher } from "./locale-switcher";
import { LogoutButton } from "./logout-button";
import { ThemeToggle } from "./theme-toggle";
import { MobileNav } from "./mobile-nav";

interface NavBarProps {
  locale: string;
  displayName: string;
  isAdmin: boolean;
  profileUserId: string;
  t: {
    predictions: string;
    scoreboard: string;
    podio: string;
    rules: string;
    profile: string;
    admin: string;
    logout: string;
    menu: string;
  };
}

export function NavBar({
  locale,
  displayName,
  isAdmin,
  profileUserId,
  t,
}: NavBarProps) {
  return (
    <nav className="relative border-b border-white/10 bg-gradient-to-r from-[#05060A] via-[#0B0F1F] to-[#140A1A] text-white backdrop-blur-md">
      <div className="mx-auto flex min-h-16 max-w-6xl items-center gap-4 px-4 py-3 sm:py-4">
        
        {/* Logo */}
        <Link
          href={`/${locale}/predictions`}
          className="flex shrink-0 items-center gap-3"
        >
          <span className="relative inline-flex items-center justify-center">
            {/* Glow */}
            <span className="absolute inset-0 rounded-lg bg-pink-500/20 blur-md opacity-70"></span>

            <Image
              src="/logo.svg"
              alt="MX Predicto"
              width={56}
              height={44}
              priority
              className="relative h-10 w-auto"
            />
          </span>

          <span className="hidden font-semibold tracking-[0.15em] text-white/80 sm:inline">
            WORLD CUP 26
          </span>
        </Link>

        {/* Mobile menu */}
        <MobileNav
          locale={locale}
          isAdmin={isAdmin}
          profileUserId={profileUserId}
          t={t}
        />

        {/* Nav links */}
        <div className="hidden flex-1 items-center gap-2 sm:flex">
          <NavLink href={`/${locale}/predictions`}>
            {t.predictions}
          </NavLink>
          <NavLink href={`/${locale}/podio`}>
            {t.podio}
          </NavLink>
          <NavLink href={`/${locale}/scoreboard`}>
            {t.scoreboard}
          </NavLink>
          <NavLink href={`/${locale}/rules`}>
            {t.rules}
          </NavLink>

          {profileUserId && (
            <NavLink href={`/${locale}/profile/${profileUserId}`}>
              {t.profile}
            </NavLink>
          )}

          {isAdmin && (
            <NavLink href={`/${locale}/admin`}>
              {t.admin}
            </NavLink>
          )}
        </div>

        {/* Right side */}
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden text-sm font-medium text-white/60 sm:block">
            {displayName}
          </span>

          <ThemeToggle />
          <LocaleSwitcher currentLocale={locale} />
          <LogoutButton locale={locale} label={t.logout} />
        </div>
      </div>

      {/* Bottom glow line */}
      <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-pink-500/40 to-transparent"></div>
    </nav>
  );
}

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group relative px-3 py-1 text-sm text-white/70 transition-all duration-200 hover:text-white"
    >
      <span className="relative z-10">{children}</span>

      {/* Glow hover */}
      <span className="absolute inset-0 rounded-md opacity-0 transition-all duration-300 group-hover:opacity-100 bg-gradient-to-r from-pink-500/20 to-purple-500/20 blur-sm"></span>
    </Link>
  );
}