"use client";

import * as React from "react";
import { cn } from "@/src/lib/cn";

/** Logo circular de un activo con fallback a iniciales (logoUrl null o carga
 *  fallida). El CDN se hotlinkea desde el navegador — el server no toca red. */
export function AssetLogo({
  name,
  logoUrl,
  size = 20,
  className,
}: {
  name: string;
  logoUrl: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  if (!logoUrl || failed) {
    return (
      <span
        aria-hidden
        style={{ width: size, height: size, fontSize: Math.max(8, size * 0.42) }}
        className={cn(
          "inline-flex shrink-0 select-none items-center justify-center rounded-full bg-muted font-semibold uppercase text-muted-foreground",
          className,
        )}
      >
        {name.trim().slice(0, 2)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- CDN externo sin dominio configurable; next/image no aporta aquí
    <img
      src={logoUrl}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("shrink-0 rounded-full object-contain", className)}
    />
  );
}
