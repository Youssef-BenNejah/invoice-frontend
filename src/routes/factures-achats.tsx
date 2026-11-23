import { createFileRoute } from "@tanstack/react-router";
import { InvoiceListPage } from "@/components/app/InvoiceList";
import { requireAuth } from "@/lib/route-guards";

export const Route = createFileRoute("/factures-achats")({
  beforeLoad: requireAuth,
  head: () => ({
    meta: [
      { title: "Factures Achats" },
      { name: "description", content: "Vos factures d'achat fournisseurs — chaque facture alimente le stock." },
    ],
  }),
  component: () => (
    <InvoiceListPage
      type="Achat"
      title="Factures Achats"
      subtitle="Vos factures d'achat fournisseurs — chaque facture alimente le stock."
      newLabel="Nouvelle facture d'achat"
    />
  ),
});
