import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout, PageHeader } from "@/components/app/AdminLayout";
import { DataTable, type Column } from "@/components/app/DataTable";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, formatMoney } from "@/lib/mock-data";
import {
  ApiError,
  downloadStockReportPdf,
  getStockDashboard,
  getStockVenteDashboard,
  listStockMovements,
  type ApiStockDashboardItem,
  type ApiStockMovement,
  type ApiStockMovementType,
  type ApiStockVenteDashboardItem,
} from "@/lib/api";
import { requireAuth } from "@/lib/route-guards";

export const Route = createFileRoute("/services")({
  beforeLoad: requireAuth,
  head: () => ({
    meta: [
      { title: "Stock" },
      { name: "description", content: "Suivi du stock par article, mis à jour à chaque facture d'achat ou de vente." },
    ],
  }),
  component: Stock,
});

function Stock() {
  const [tab, setTab] = useState<"stock" | "vente" | "mouvements">("stock");

  return (
    <AdminLayout>
      <PageHeader
        title="Stock"
        subtitle="Une ligne par article dès sa première facture d'achat — mise à jour à chaque facture d'achat ou de vente."
      />

      <div className="mb-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="stock">Stock</TabsTrigger>
            <TabsTrigger value="vente">Vente</TabsTrigger>
            <TabsTrigger value="mouvements">Mouvements de stock</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {tab === "stock" ? <StockTab /> : tab === "vente" ? <VenteTab /> : <MouvementsTab />}
    </AdminLayout>
  );
}

function StockTab() {
  const { data: dashboard, isLoading, isError } = useQuery({ queryKey: ["stock-dashboard"], queryFn: getStockDashboard });
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const downloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      await downloadStockReportPdf();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Échec de la génération du rapport";
      toast.error("Échec de la génération du rapport", { description: message });
    } finally {
      setDownloadingPdf(false);
    }
  };

  const columns: Column<ApiStockDashboardItem>[] = [
    {
      key: "article",
      header: "Article",
      sortable: true,
      sortValue: (i) => i.article,
      cell: (i) => <span className="font-medium">{i.article}</span>,
    },
    {
      key: "ref",
      header: "Réf.",
      cell: (i) => <span className="text-sm text-muted-foreground">{i.ref || ""}</span>,
    },
    {
      key: "quantite",
      header: "Quantité",
      className: "text-right",
      sortable: true,
      sortValue: (i) => i.quantite,
      cell: (i) => <span className="font-semibold">{i.quantite}</span>,
    },
    {
      key: "puHT",
      header: "PU HT",
      className: "text-right",
      sortable: true,
      sortValue: (i) => i.puHT,
      cell: (i) => <span className="text-sm">{formatMoney(i.puHT, "TND")}</span>,
    },
    {
      key: "totalHT",
      header: "Total HT",
      className: "text-right",
      sortable: true,
      sortValue: (i) => i.totalHT,
      cell: (i) => <span className="text-sm font-medium">{formatMoney(i.totalHT, "TND")}</span>,
    },
    {
      key: "puTTC",
      header: "PU TTC",
      className: "text-right",
      sortable: true,
      sortValue: (i) => i.puTTC,
      cell: (i) => <span className="text-sm">{formatMoney(i.puTTC, "TND")}</span>,
    },
    {
      key: "totalTTC",
      header: "Total TTC",
      className: "text-right",
      sortable: true,
      sortValue: (i) => i.totalTTC,
      cell: (i) => <span className="font-semibold text-gradient-ocean">{formatMoney(i.totalTTC, "TND")}</span>,
    },
  ];

  return (
    <>
      {isError ? (
        <div className="mb-6 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Impossible de charger le stock. Vérifiez que le serveur backend est démarré.
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap items-center justify-end gap-3">
        <Button variant="outline" className="rounded-xl" onClick={downloadPdf} disabled={downloadingPdf}>
          <Download className="mr-1.5 size-4" /> {downloadingPdf ? "Génération…" : "Rapport PDF"}
        </Button>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <div className="glass rounded-2xl p-5">
          <p className="text-sm text-muted-foreground">Valeur totale du stock (HT)</p>
          <p className="mt-2 text-2xl font-semibold">{formatMoney(dashboard?.totalValueHT ?? 0, "TND")}</p>
        </div>
        <div className="glass rounded-2xl p-5">
          <p className="text-sm text-muted-foreground">Valeur totale du stock (TTC)</p>
          <p className="mt-2 text-2xl font-semibold text-gradient-ocean">{formatMoney(dashboard?.totalValueTTC ?? 0, "TND")}</p>
        </div>
      </div>

      <DataTable
        rows={(dashboard?.items ?? []).map((i) => ({ ...i, id: i.productId }))}
        columns={columns}
        searchKeys={(i) => `${i.article} ${i.ref ?? ""}`}
        searchPlaceholder="Rechercher un article…"
        emptyTitle={isLoading ? "Chargement…" : "Aucun article en stock"}
        defaultSort={{ key: "article", dir: "asc" }}
      />
    </>
  );
}

function VenteTab() {
  const { data: dashboard, isLoading, isError } = useQuery({
    queryKey: ["stock-dashboard-vente"],
    queryFn: getStockVenteDashboard,
  });

  const columns: Column<ApiStockVenteDashboardItem>[] = [
    {
      key: "article",
      header: "Article",
      sortable: true,
      sortValue: (i) => i.article,
      cell: (i) => <span className="font-medium">{i.article}</span>,
    },
    {
      key: "ref",
      header: "Réf.",
      cell: (i) => <span className="text-sm text-muted-foreground">{i.ref || ""}</span>,
    },
    {
      key: "quantite",
      header: "Quantité",
      className: "text-right",
      sortable: true,
      sortValue: (i) => i.quantite,
      cell: (i) => <span className="font-semibold">{i.quantite}</span>,
    },
    {
      key: "puHTVente",
      header: "PU HT vente",
      className: "text-right",
      sortable: true,
      sortValue: (i) => i.puHTVente,
      cell: (i) => <span className="text-sm">{formatMoney(i.puHTVente, "TND")}</span>,
    },
    {
      key: "totalHTVente",
      header: "Total HT vente",
      className: "text-right",
      sortable: true,
      sortValue: (i) => i.totalHTVente,
      cell: (i) => <span className="text-sm font-medium">{formatMoney(i.totalHTVente, "TND")}</span>,
    },
    {
      key: "puTTCVente",
      header: "PU TTC vente",
      className: "text-right",
      sortable: true,
      sortValue: (i) => i.puTTCVente,
      cell: (i) => <span className="text-sm">{formatMoney(i.puTTCVente, "TND")}</span>,
    },
    {
      key: "totalTTCVente",
      header: "Total TTC vente",
      className: "text-right",
      sortable: true,
      sortValue: (i) => i.totalTTCVente,
      cell: (i) => <span className="font-semibold text-gradient-ocean">{formatMoney(i.totalTTCVente, "TND")}</span>,
    },
  ];

  return (
    <>
      {isError ? (
        <div className="mb-6 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Impossible de charger la valorisation de vente. Vérifiez que le serveur backend est démarré.
        </div>
      ) : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <div className="glass rounded-2xl p-5">
          <p className="text-sm text-muted-foreground">Valeur de vente du stock (HT)</p>
          <p className="mt-2 text-2xl font-semibold">{formatMoney(dashboard?.totalValueHTVente ?? 0, "TND")}</p>
        </div>
        <div className="glass rounded-2xl p-5">
          <p className="text-sm text-muted-foreground">Valeur de vente du stock (TTC)</p>
          <p className="mt-2 text-2xl font-semibold text-gradient-ocean">{formatMoney(dashboard?.totalValueTTCVente ?? 0, "TND")}</p>
        </div>
      </div>

      <DataTable
        rows={(dashboard?.items ?? []).map((i) => ({ ...i, id: i.productId }))}
        columns={columns}
        searchKeys={(i) => `${i.article} ${i.ref ?? ""}`}
        searchPlaceholder="Rechercher un article…"
        emptyTitle={isLoading ? "Chargement…" : "Aucun article en stock"}
        defaultSort={{ key: "article", dir: "asc" }}
      />
    </>
  );
}

const movementTypeLabel: Record<ApiStockMovementType, string> = {
  ACHAT: "Facture d'achat",
  VENTE: "Facture de vente",
  AJUSTEMENT: "Ajustement manuel",
  ANNULATION_ACHAT: "Annulation d'achat",
  ANNULATION_VENTE: "Annulation de vente",
};

function MouvementsTab() {
  const { data: movements = [], isLoading, isError } = useQuery({
    queryKey: ["stock-movements"],
    queryFn: listStockMovements,
  });

  const columns: Column<ApiStockMovement>[] = [
    {
      key: "created",
      header: "Date",
      sortable: true,
      sortValue: (m) => m.created,
      cell: (m) => <span className="text-sm text-muted-foreground">{formatDate(m.created)}</span>,
    },
    {
      key: "article",
      header: "Article",
      sortable: true,
      sortValue: (m) => m.article ?? "",
      cell: (m) => <span className="font-medium">{m.article ?? ""}</span>,
    },
    {
      key: "type",
      header: "Mouvement",
      cell: (m) => <span className="text-sm">{movementTypeLabel[m.type]}</span>,
    },
    {
      key: "quantityDelta",
      header: "Quantité",
      className: "text-right",
      sortable: true,
      sortValue: (m) => m.quantityDelta,
      cell: (m) => (
        <span className={`font-semibold ${m.quantityDelta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
          {m.quantityDelta >= 0 ? "+" : ""}
          {m.quantityDelta}
        </span>
      ),
    },
    {
      key: "value",
      header: "Valeur (HT)",
      className: "text-right",
      sortable: true,
      sortValue: (m) => m.quantityDelta * m.unitCost,
      cell: (m) => {
        const value = m.quantityDelta * m.unitCost;
        return (
          <span className={`text-sm font-medium ${value >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
            {value >= 0 ? "+" : ""}
            {formatMoney(value, "TND")}
          </span>
        );
      },
    },
    {
      key: "quantityAfter",
      header: "Stock résultant",
      className: "text-right",
      cell: (m) => <span className="text-sm text-muted-foreground">{m.quantityAfter}</span>,
    },
  ];

  return (
    <>
      {isError ? (
        <div className="mb-6 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Impossible de charger les mouvements de stock. Vérifiez que le serveur backend est démarré.
        </div>
      ) : null}

      <DataTable
        rows={movements}
        columns={columns}
        searchKeys={(m) => `${m.article ?? ""} ${m.ref ?? ""}`}
        searchPlaceholder="Rechercher un mouvement…"
        emptyTitle={isLoading ? "Chargement…" : "Aucun mouvement de stock"}
        defaultSort={{ key: "created", dir: "desc" }}
      />
    </>
  );
}
