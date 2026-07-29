export const dynamic = "force-dynamic";

import { AdvisorChat } from "@/src/components/features/advisor/AdvisorChat";
import { AdvisorStatusBar } from "@/src/components/features/advisor/AdvisorStatusBar";
import { readAdvisorConfig } from "@/src/lib/advisor/config";
import { readProposals } from "@/src/lib/advisor/proposals";
import { getAdvisorMarketStatus } from "@/src/server/advisor";
import {
  getConversationMessages,
  listConversationMetas,
} from "@/src/server/advisorConversations";

export default function AsesorPage() {
  const proposals = readProposals();
  const market = getAdvisorMarketStatus();
  const marketIngest = readAdvisorConfig().marketIngestEnabled;
  const conversations = listConversationMetas();
  // Solo el hilo activo (el más reciente) viaja con mensajes; el resto se
  // carga al seleccionar su pestaña.
  const activeMessages = conversations[0]
    ? getConversationMessages(conversations[0].id)
    : [];

  return (
    <div className="flex h-full flex-col gap-5 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Asesor</h1>
        <p className="text-sm text-muted-foreground">
          Tu asesor financiero AI. Conoce tus posiciones en vivo, tu perfil y el estado de los
          mercados. Sus respuestas son informativas, no asesoramiento regulado.
        </p>
      </header>

      <AdvisorStatusBar market={market} marketIngest={marketIngest} />
      <AdvisorChat
        initialProposals={proposals}
        initialConversations={conversations}
        initialActiveMessages={activeMessages}
      />
    </div>
  );
}
