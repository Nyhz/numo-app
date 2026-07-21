"use client";

import * as React from "react";
import { ArrowLeftRight, ArrowUpFromLine, Divide, TrendingUp } from "lucide-react";
import { Button } from "@/src/components/ui/Button";
import { CreateSwapModal } from "./CreateSwapModal";
import { CreateDividendModal } from "./CreateDividendModal";
import { CreateWithdrawalModal } from "./CreateWithdrawalModal";
import { CreateSplitModal } from "./CreateSplitModal";

type Props = {
  accounts: { id: string; name: string }[];
  assets: { id: string; name: string; currency: string }[];
};

export function TransactionsExtraActions({ accounts, assets }: Props) {
  const [swapOpen, setSwapOpen] = React.useState(false);
  const [dividendOpen, setDividendOpen] = React.useState(false);
  const [withdrawalOpen, setWithdrawalOpen] = React.useState(false);
  const [splitOpen, setSplitOpen] = React.useState(false);
  const disabled = accounts.length === 0 || assets.length === 0;

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          size="md"
          variant="secondary"
          onClick={() => setDividendOpen(true)}
          disabled={disabled}
        >
          <TrendingUp className="h-4 w-4" />
          Registrar dividendo
        </Button>
        <Button
          size="md"
          variant="secondary"
          onClick={() => setSwapOpen(true)}
          disabled={disabled}
        >
          <ArrowLeftRight className="h-4 w-4" />
          Registrar swap
        </Button>
        <Button
          size="md"
          variant="secondary"
          onClick={() => setWithdrawalOpen(true)}
          disabled={disabled}
        >
          <ArrowUpFromLine className="h-4 w-4" />
          Retirar activo
        </Button>
        <Button
          size="md"
          variant="secondary"
          onClick={() => setSplitOpen(true)}
          disabled={disabled}
        >
          <Divide className="h-4 w-4" />
          Registrar split
        </Button>
      </div>
      <CreateSwapModal
        open={swapOpen}
        onOpenChange={setSwapOpen}
        accounts={accounts}
        assets={assets}
      />
      <CreateDividendModal
        open={dividendOpen}
        onOpenChange={setDividendOpen}
        accounts={accounts}
        assets={assets}
      />
      <CreateWithdrawalModal
        open={withdrawalOpen}
        onOpenChange={setWithdrawalOpen}
        accounts={accounts}
        assets={assets}
      />
      <CreateSplitModal
        open={splitOpen}
        onOpenChange={setSplitOpen}
        accounts={accounts}
        assets={assets}
      />
    </>
  );
}
