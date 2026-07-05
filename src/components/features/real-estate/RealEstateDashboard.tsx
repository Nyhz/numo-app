"use client";

import { Building2 } from "lucide-react";
import * as React from "react";
import { Button } from "@/src/components/ui/Button";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import type { RealEstateOverview } from "@/src/server/realEstate";
import { CreatePropertyModal } from "./CreatePropertyModal";
import { PropertySection } from "./PropertySection";

export function RealEstateDashboard({ overview }: { overview: RealEstateOverview }) {
  const [creating, setCreating] = React.useState(false);
  return (
    <div className="flex flex-col gap-8">
      {overview.properties.length === 0 ? (
        <StatesBlock
          mode="empty"
          title="Sin inmuebles registrados"
          description="Registra la compra de tu vivienda para incorporar su equity al patrimonio."
          icon={<Building2 className="h-6 w-6" />}
          cta={{ label: "Registrar inmueble", onClick: () => setCreating(true) }}
        />
      ) : (
        <>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setCreating(true)}>
              Registrar inmueble
            </Button>
          </div>
          {overview.properties.map((p) => (
            <PropertySection key={p.property.id} summary={p} />
          ))}
        </>
      )}
      <CreatePropertyModal open={creating} onOpenChange={setCreating} />
    </div>
  );
}
