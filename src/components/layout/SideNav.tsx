"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  Building2,
  Coins,
  Crosshair,
  FileText,
  LayoutDashboard,
  Lightbulb,
  Receipt,
  ScrollText,
  Settings,
  Sparkles,
  Star,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/src/lib/cn";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

// Grupos por afinidad: visión global, registro de cartera, mercado y
// planificación. Separados visualmente con dividers en el render.
const primaryGroups: NavItem[][] = [
  [
    { href: "/", label: "Resumen", icon: LayoutDashboard },
    { href: "/statement", label: "Extracto", icon: FileText },
  ],
  [
    { href: "/accounts", label: "Cuentas", icon: Wallet },
    { href: "/assets", label: "Activos", icon: Coins },
    { href: "/transactions", label: "Transacciones", icon: ArrowLeftRight },
    { href: "/real-estate", label: "Inmuebles", icon: Building2 },
    { href: "/taxes", label: "Fiscalidad", icon: Receipt },
  ],
  [
    { href: "/watchlist", label: "Watchlist", icon: Star },
    { href: "/discover", label: "Descubrir", icon: Lightbulb },
  ],
  [
    { href: "/objectives", label: "Objetivos", icon: Crosshair },
    { href: "/simulador", label: "Simulador", icon: TrendingUp },
    { href: "/asesor", label: "Asesor", icon: Sparkles },
  ],
];

const secondaryItems: NavItem[] = [
  { href: "/audit", label: "Auditoría", icon: ScrollText },
  { href: "/settings", label: "Ajustes", icon: Settings },
];

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SideNav() {
  const pathname = usePathname();

  const renderItem = ({ href, label, icon: Icon }: NavItem) => {
    const active = isActive(pathname, href);
    return (
      <li key={href}>
        <Link
          href={href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            active
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
          <span>{label}</span>
        </Link>
      </li>
    );
  };

  return (
    <nav
      aria-label="Navegación principal"
      className="hidden h-full w-56 shrink-0 flex-col border-r border-border bg-background md:flex"
    >
      <div className="flex flex-col p-3">
        {primaryGroups.map((group, i) => (
          <ul
            key={i}
            className={cn(
              "flex flex-col gap-0.5",
              // Divider fino entre grupos, con aire a ambos lados.
              i > 0 && "mt-3 border-t border-border/60 pt-3",
            )}
          >
            {group.map(renderItem)}
          </ul>
        ))}
      </div>
      <ul className="mt-auto flex flex-col gap-0.5 border-t border-border/60 p-3">
        {secondaryItems.map(renderItem)}
      </ul>
    </nav>
  );
}
