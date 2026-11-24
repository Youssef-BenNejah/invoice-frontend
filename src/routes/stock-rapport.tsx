import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout, PageHeader } from "@/components/app/AdminLayout";
import { EmptyState } from "@/components/app/EmptyState";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatMoney } from "@/lib/mock-data";
import { ApiError, downloadStockReportMonthlyPdf, getStockReport, type ApiStockReportItem } from "@/lib/api";
import { requireAuth } from "@/lib/route-guards";

const MONTHS = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

export const Route = createFileRoute("/stock-rapport")({
  beforeLoad: requireAuth,
  head: () => ({
    meta: [
      { title: "Rapport de stock" },
      { name: "description", content: "Rapport mensuel de la valorisation du stock, exportable en PDF." },
    ],
  }),
  component: StockRapport,
});

function StockRapport() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const { data: report, isLoading, isError } = useQuery({
    queryKey: ["stock-report", year, month],
    queryFn: () => getStockReport(year, month),
  });

  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() - i);
  const items: ApiStockReportItem[] = report?.items ?? [];

  const downloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      await downloadStockReportMonthlyPdf(year, month);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Échec de la génération du rapport";
      toast.error("Échec de la génération du rapport", { description: message });
    } finally {
      setDownloadingPdf(false);
    }
  };

  return (
    <AdminLayout>
      <PageHeader
        title="Rapport de stock"
        subtitle="Valorisation du stock à la fin du mois sélectionné."
        actions={
          <Button variant="outline" className="rounded-xl" onClick={downloadPdf} disabled={downloadingPdf}>
            <Download className="mr-1.5 size-4" /> {downloadingPdf ? "Génération…" : "Rapport PDF"}
          </Button>
        }
      />

      {isError ? (
        <div className="mb-6 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Impossible de charger le rapport de stock. Vérifiez que le serveur backend est démarré.
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
          <SelectTrigger className="h-10 w-[150px] rounded-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map((label, idx) => (
              <SelectItem key={label} value={String(idx + 1)}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="h-10 w-[110px] rounded-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="glass rounded-2xl">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-xs tracking-wide text-muted-foreground uppercase">
                <th className="px-4 py-3 font-semibold">Article</th>
                <th className="px-4 py-3 text-right font-semibold">Quantité</th>
                <th className="px-4 py-3 text-right font-semibold">PU HT</th>
                <th className="px-4 py-3 text-right font-semibold">Total HT</th>
                <th className="px-4 py-3 text-right font-semibold">PU TTC</th>
                <th className="px-4 py-3 text-right font-semibold">Total TTC</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.productId} className="border-t border-border/50 transition-colors hover:bg-ice/40 dark:hover:bg-white/5">
                  <td className="px-4 py-3 align-middle font-medium">{item.article}</td>
                  <td className="px-4 py-3 text-right align-middle font-semibold">{item.quantite}</td>
                  <td className="px-4 py-3 text-right align-middle text-sm">{formatMoney(item.puHT, "TND")}</td>
                  <td className="px-4 py-3 text-right align-middle text-sm font-medium">{formatMoney(item.totalHT, "TND")}</td>
                  <td className="px-4 py-3 text-right align-middle text-sm">{formatMoney(item.puTTC, "TND")}</td>
                  <td className="px-4 py-3 text-right align-middle font-semibold text-gradient-ocean">
                    {formatMoney(item.totalTTC, "TND")}
                  </td>
                </tr>
              ))}
            </tbody>
            {items.length > 0 ? (
              <tfoot>
                <tr className="border-t-2 border-border/70 bg-ice/30 dark:bg-white/5">
                  <td className="px-4 py-3 font-semibold" colSpan={3}>
                    Totaux
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">{formatMoney(report?.totalHT ?? 0, "TND")}</td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3 text-right font-semibold text-gradient-ocean">{formatMoney(report?.totalTTC ?? 0, "TND")}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
          {items.length === 0 ? (
            <EmptyState
              title={isLoading ? "Chargement…" : "Aucun stock à cette date"}
              description="Essayez un autre mois ou une autre année."
            />
          ) : null}
        </div>
      </div>

      {items.length > 0 ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="glass rounded-2xl p-5">
            <p className="text-sm text-muted-foreground">Total HT</p>
            <p className="mt-2 text-2xl font-semibold">{formatMoney(report?.totalHT ?? 0, "TND")}</p>
          </div>
          <div className="glass rounded-2xl p-5">
            <p className="text-sm text-muted-foreground">Total TVA</p>
            <p className="mt-2 text-2xl font-semibold">{formatMoney(report?.totalTVA ?? 0, "TND")}</p>
          </div>
          <div className="glass rounded-2xl p-5">
            <p className="text-sm text-muted-foreground">Total TTC</p>
            <p className="mt-2 text-2xl font-semibold text-gradient-ocean">{formatMoney(report?.totalTTC ?? 0, "TND")}</p>
          </div>
        </div>
      ) : null}
    </AdminLayout>
  );
}
