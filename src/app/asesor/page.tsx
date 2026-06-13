export const dynamic = "force-dynamic";

import { AdvisorChat } from "@/src/components/features/advisor/AdvisorChat";
import { AdvisorCostBar } from "@/src/components/features/advisor/AdvisorCostBar";
import { readAdvisorConfig } from "@/src/lib/advisor/config";
import { readProposals } from "@/src/lib/advisor/proposals";
import { getAdvisorCostSummary, getAdvisorMarketStatus } from "@/src/server/advisor";

export default function AsesorPage() {
  const proposals = readProposals();
  const costs = getAdvisorCostSummary();
  const market = getAdvisorMarketStatus();
  const marketIngest = readAdvisorConfig().marketIngestEnabled;

  return (
    <div className="flex h-full flex-col gap-5 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Asesor</h1>
        <p className="text-sm text-muted-foreground">
          Tu asesor financiero AI. Conoce tus posiciones en vivo, tu perfil y el estado de los
          mercados. Sus respuestas son informativas, no asesoramiento regulado.
        </p>
      </header>

      <AdvisorCostBar summary={costs} market={market} marketIngest={marketIngest} />
      <AdvisorChat initialProposals={proposals} />
    </div>
  );
}
