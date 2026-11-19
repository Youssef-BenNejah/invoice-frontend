import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout, PageHeader } from "@/components/app/AdminLayout";
import { DataTable, type Column } from "@/components/app/DataTable";
import { DetailField, DetailSection, DetailSheet } from "@/components/app/DetailSheet";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/mock-data";
import { ApiError, deleteAchat, getAchatById, listAchats, type ApiAchat } from "@/lib/api";
import { requireAuth } from "@/lib/route-guards";

export const Route = createFileRoute("/achats")({
  beforeLoad: requireAuth,
  head: () => ({
    meta: [
      { title: "Achats — Harmonie-dev" },
      { name: "description", content: "Vos factures d'achat fournisseurs — chaque achat alimente le stock." },
    ],
  }),
  component: Achats,
});

function Achats() {
  const queryClient = useQueryClient();
  const { data: rows = [], isLoading, isError } = useQuery({ queryKey: ["achats"], queryFn: listAchats });
  const [viewingId, setViewingId] = useState<string | null>(null);

  const { data: viewing } = useQuery({
    queryKey: ["achat", viewingId],
    queryFn: () => getAchatById(viewingId as string),
    enabled: !!viewingId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["achats"] });
    queryClient.invalidateQueries({ queryKey: ["services"] });
  };

  const onError = (err: unknown, fallback: string) => {
    const message = err instanceof ApiError ? err.message : fallback;
    toast.error(fallback, { description: message });
  };

  const deleteMutation = useMutation({
    mutationFn: deleteAchat,
    onSuccess: (_data, id) => {
      const a = rows.find((r) => r.id === id);
      toast("Achat supprimé", { description: a ? `#${a.number}/${a.year}` : undefined });
      invalidate();
    },
    onError: (err) => onError(err, "Échec de la suppression — le stock a peut-être évolué depuis cet achat"),
  });

  const columns: Column<ApiAchat>[] = [
    {
      key: "number",
      header: "Achat",
      sortable: true,
      sortValue: (r) => r.number,
      cell: (r) => (
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-ocean/10 text-ocean dark:text-sky">
            <ShoppingBag className="size-4" />
          </span>
          <div>
            <p className="font-medium">
              #{r.number}/{r.year}
            </p>
            <p className="text-xs text-muted-foreground">{r.fournisseur?.nom ?? "Fournisseur inconnu"}</p>
          </div>
        </div>
      ),
    },
    {
      key: "date",
      header: "Date",
      sortable: true,
      sortValue: (r) => r.date,
      cell: (r) => <span className="text-sm">{r.date}</span>,
    },
    {
      key: "items",
      header: "Lignes",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.items.length}</span>,
    },
    {
      key: "total",
      header: "Total TTC",
      className: "text-right",
      sortable: true,
      sortValue: (r) => r.total,
      cell: (r) => <span className="font-semibold">{formatMoney(r.total, r.currency?.code)}</span>,
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (r) => (
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" size="icon" className="size-8 rounded-lg" onClick={() => setViewingId(r.id)}>
            <Eye className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-lg text-destructive hover:text-destructive"
            onClick={() => deleteMutation.mutate(r.id)}
            disabled={deleteMutation.isPending}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <AdminLayout>
      <PageHeader
        title="Achats"
        subtitle="Factures d'achat fournisseurs — chaque achat alimente le stock immédiatement."
        actions={
          <Button className="rounded-xl" asChild>
            <Link to="/achats/nouvelle">
              <Plus className="mr-1.5 size-4" /> Nouvel achat
            </Link>
          </Button>
        }
      />

      {isError ? (
        <div className="mb-6 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Impossible de charger les achats — vérifiez que le serveur backend est démarré.
        </div>
      ) : null}

      <DataTable
        rows={rows}
        columns={columns}
        searchKeys={(r) => `${r.number} ${r.fournisseur?.nom ?? ""}`}
        searchPlaceholder="Rechercher un achat…"
        emptyTitle={isLoading ? "Chargement…" : "Aucun achat"}
      />

      <DetailSheet
        open={!!viewingId}
        onOpenChange={(o) => !o && setViewingId(null)}
        icon={<ShoppingBag className="size-5 text-ocean" />}
        title={viewing ? `Achat #${viewing.number}/${viewing.year}` : ""}
        subtitle={viewing?.fournisseur?.nom ?? ""}
      >
        {viewing ? (
          <>
            <DetailField label="Date" value={viewing.date} />
            <DetailField label="Devise" value={viewing.currency?.code} />
            <DetailField label="Note" value={viewing.note} />
            <DetailSection title="Lignes">
              {viewing.items.map((it) => (
                <div key={it.id} className="flex items-center justify-between gap-3 border-b border-border/50 py-2.5 text-sm last:border-0">
                  <div>
                    <p className="font-medium">{it.article}</p>
                    <p className="text-xs text-muted-foreground">
                      {it.quantity} × {formatMoney(it.unitPriceHT, viewing.currency?.code)} HT
                    </p>
                  </div>
                  <span className="font-semibold">{formatMoney(it.total, viewing.currency?.code)}</span>
                </div>
              ))}
            </DetailSection>
            <DetailField label="Total HT" value={formatMoney(viewing.subtotal, viewing.currency?.code)} />
            <DetailField label="Taxes" value={formatMoney(viewing.taxAmount, viewing.currency?.code)} />
            <DetailField label="Total TTC" value={formatMoney(viewing.total, viewing.currency?.code)} />
          </>
        ) : null}
      </DetailSheet>
    </AdminLayout>
  );
}
