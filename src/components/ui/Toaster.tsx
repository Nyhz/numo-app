"use client";

import * as React from "react";
import { Toaster as SonnerToaster } from "sonner";

/** Lee el tema actual de `<html data-theme>` y lo sigue en vivo — la misma
 *  fuente de verdad que usa el toggle del AppShell, sin re-implementar estado
 *  de tema por componente. */
function useHtmlTheme(): "dark" | "light" {
  const subscribe = React.useCallback((onChange: () => void) => {
    const observer = new MutationObserver(onChange);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  const read = () =>
    document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  return React.useSyncExternalStore(subscribe, read, () => "dark");
}

/** Toaster global de la app (sonner) con los tokens del tema. Un único mount
 *  en el layout raíz; los componentes lanzan toasts vía `src/lib/toast.ts`. */
export function Toaster() {
  const theme = useHtmlTheme();
  return (
    <SonnerToaster
      theme={theme}
      position="bottom-right"
      duration={3500}
      gap={8}
      toastOptions={{
        // Mismo lenguaje visual que los tooltips/cards del panel.
        classNames: {
          toast:
            "rounded-md border border-border/70 !bg-card/95 !text-foreground shadow-sm backdrop-blur",
          title: "text-sm font-medium",
          description: "text-xs text-muted-foreground",
          success: "[&_[data-icon]]:text-success",
          error: "[&_[data-icon]]:text-destructive",
          info: "[&_[data-icon]]:text-muted-foreground",
        },
      }}
    />
  );
}
