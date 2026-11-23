import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Layers, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout, PageHeader } from "@/components/app/AdminLayout";
import { DataTable, type Column } from "@/components/app/DataTable";
import { DetailField, DetailSheet } from "@/components/app/DetailSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { formatMoney } from "@/lib/mock-data";
import {
  ApiError,
  createService,
  deleteService,
  getServiceById,
  listServices,
  listTaxes,
  updateService,
  type ApiService,
  type ServicePayload,
} from "@/lib/api";
import { requireAuth } from "@/lib/route-guards";

export const Route = createFileRoute("/articles")({
  beforeLoad: requireAuth,
  head: () => ({
    meta: [
      { title: "Articles" },
      { name: "description", content: "Gérez le catalogue d'articles : dimensions, prix et marge." },
    ],
  }),
  component: Articles,
});

type FormState = ServicePayload;
const emptyForm = (): FormState => ({
  name: "",
  price: 0,
  currency: "TND",
  description: "",
  reference: "",
  defaultTaxId: "",
  longueur: 0,
  largeur: 0,
  hauteur: 0,
  margeGain: 0,
});

const computePrixAchat = (f: FormState) => (f.longueur ?? 0) * (f.largeur ?? 0) * (f.hauteur ?? 0) * (f.price ?? 0);

function Articles() {
  const queryClient = useQueryClient();
  const { data: rows = [], isLoading, isError } = useQuery({ queryKey: ["services"], queryFn: listServices });
  const { data: taxes = [] } = useQuery({ queryKey: ["taxes"], queryFn: listTaxes });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ApiService | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [viewingId, setViewingId] = useState<string | null>(null);

  const { data: viewing } = useQuery({
    queryKey: ["service", viewingId],
    queryFn: () => getServiceById(viewingId as string),
    enabled: !!viewingId,
  });

  const invalidateArticles = () => queryClient.invalidateQueries({ queryKey: ["services"] });

  const onError = (err: unknown, fallback: string) => {
    const message = err instanceof ApiError ? err.message : fallback;
    toast.error(fallback, { description: message });
  };

  const createMutation = useMutation({
    mutationFn: createService,
    onSuccess: (s) => {
      toast.success("Article ajouté", { description: s.name });
      setOpen(false);
      invalidateArticles();
    },
    onError: (err) => onError(err, "Échec de la création"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ServicePayload }) => updateService(id, payload),
    onSuccess: (s) => {
      toast.success("Article mis à jour", { description: s.name });
      setOpen(false);
      invalidateArticles();
    },
    onError: (err) => onError(err, "Échec de la mise à jour"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteService,
    onSuccess: (_data, id) => {
      const s = rows.find((r) => r.id === id);
      toast("Article supprimé", { description: s?.name });
      invalidateArticles();
    },
    onError: (err) => onError(err, "Échec de la suppression"),
  });

  const taxById = (id?: string | null) => taxes.find((t) => t.id === id);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setOpen(true);
  };

  const openEdit = (s: ApiService) => {
    setEditing(s);
    setForm({
      name: s.name,
      price: s.price,
      currency: s.currency,
      description: s.description ?? "",
      reference: s.reference ?? "",
      defaultTaxId: s.defaultTaxId ?? "",
      longueur: s.longueur,
      largeur: s.largeur,
      hauteur: s.hauteur,
      margeGain: s.margeGain,
    });
    setOpen(true);
  };

  const save = () => {
    if (editing) {
      updateMutation.mutate({ id: editing.id, payload: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const remove = (s: ApiService) => deleteMutation.mutate(s.id);

  const columns: Column<ApiService>[] = [
    {
      key: "name",
      header: "Article",
      sortable: true,
      sortValue: (s) => s.name,
      cell: (s) => (
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-ocean/10 text-ocean dark:text-sky">
            <Layers className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{s.name}</p>
            {s.description ? <p className="truncate text-xs text-muted-foreground">{s.description}</p> : null}
          </div>
        </div>
      ),
    },
    {
      key: "reference",
      header: "Réf.",
      cell: (s) => <span className="text-sm text-muted-foreground">{s.reference || ""}</span>,
    },
    {
      key: "tva",
      header: "TVA",
      cell: (s) => {
        const tax = taxById(s.defaultTaxId);
        return <span className="text-sm text-muted-foreground">{tax ? `${tax.name} (${tax.taxvalue}%)` : ""}</span>;
      },
    },
    {
      key: "dimensions",
      header: "Dimensions (L×l×h)",
      cell: (s) => <span className="text-sm text-muted-foreground">{s.longueur} × {s.largeur} × {s.hauteur}</span>,
    },
    {
      key: "price",
      header: "Prix",
      className: "text-right",
      sortable: true,
      sortValue: (s) => s.price,
      cell: (s) => <span className="font-semibold">{formatMoney(s.price, s.currency)}</span>,
    },
    {
      key: "prixAchat",
      header: "Prix d'achat",
      className: "text-right",
      sortable: true,
      sortValue: (s) => s.prixAchat,
      cell: (s) => <span className="text-sm">{formatMoney(s.prixAchat, s.currency)}</span>,
    },
    {
      key: "margeGain",
      header: "Marge",
      className: "text-right",
      sortable: true,
      sortValue: (s) => s.margeGain,
      cell: (s) => <span className="text-sm text-muted-foreground">{s.margeGain}%</span>,
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (s) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" className="size-8 rounded-lg" onClick={() => setViewingId(s.id)}>
            <Eye className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-8 rounded-lg" onClick={() => openEdit(s)}>
            <Pencil className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-8 rounded-lg text-destructive hover:text-destructive" onClick={() => remove(s)}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <AdminLayout>
      <PageHeader
        title="Articles"
        subtitle="Gérez votre catalogue d'articles — dimensions, prix et marge."
        actions={
          <Button className="rounded-xl" onClick={openCreate}>
            <Plus className="mr-1.5 size-4" /> Nouvel article
          </Button>
        }
      />

      {isError ? (
        <div className="mb-6 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Impossible de charger les articles. Vérifiez que le serveur backend est démarré.
        </div>
      ) : null}

      <DataTable
        rows={rows}
        columns={columns}
        searchKeys={(s) => `${s.name} ${s.reference ?? ""} ${s.description ?? ""}`}
        searchPlaceholder="Rechercher un article…"
        emptyTitle={isLoading ? "Chargement…" : "Aucun article"}
        defaultSort={{ key: "name", dir: "asc" }}
      />

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{editing ? "Modifier l'article" : "Nouvel article"}</SheetTitle>
            <SheetDescription>Décrivez l'article : dimensions, prix et marge.</SheetDescription>
          </SheetHeader>
          <div className="mt-6 grid gap-4">
            <div className="space-y-2">
              <Label>Nom</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-xl" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Référence</Label>
                <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} className="rounded-xl" />
              </div>
              <div className="space-y-2">
                <Label>TVA</Label>
                <Select value={form.defaultTaxId ?? ""} onValueChange={(v) => setForm({ ...form, defaultTaxId: v })}>
                  <SelectTrigger className="h-10 rounded-xl">
                    <SelectValue placeholder="Aucune" />
                  </SelectTrigger>
                  <SelectContent>
                    {taxes.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} ({t.taxvalue}%)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-xl border border-border/60 p-4">
              <p className="mb-3 text-sm font-semibold">Dimensions</p>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Longueur</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.longueur}
                    onChange={(e) => setForm({ ...form, longueur: Number(e.target.value) })}
                    className="rounded-xl"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Largeur</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.largeur}
                    onChange={(e) => setForm({ ...form, largeur: Number(e.target.value) })}
                    className="rounded-xl"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Hauteur</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.hauteur}
                    onChange={(e) => setForm({ ...form, hauteur: Number(e.target.value) })}
                    className="rounded-xl"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Prix</Label>
                <Input
                  type="number"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-2">
                <Label>Devise</Label>
                <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                  <SelectTrigger className="h-10 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TND">TND</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Prix d'achat</Label>
                <Input value={formatMoney(computePrixAchat(form), form.currency)} disabled className="rounded-xl" />
                <p className="text-xs text-muted-foreground">Calculé : longueur × largeur × hauteur × prix.</p>
              </div>
              <div className="space-y-2">
                <Label>Marge de gain (%)</Label>
                <Input
                  type="number"
                  value={form.margeGain}
                  onChange={(e) => setForm({ ...form, margeGain: Number(e.target.value) })}
                  className="rounded-xl"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="rounded-xl" />
            </div>
          </div>
          <SheetFooter className="mt-6">
            <Button variant="outline" className="rounded-xl" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button
              className="rounded-xl"
              onClick={save}
              disabled={!form.name || createMutation.isPending || updateMutation.isPending}
            >
              Enregistrer
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <DetailSheet
        open={!!viewingId}
        onOpenChange={(o) => !o && setViewingId(null)}
        icon={<Layers className="size-5 text-ocean" />}
        title={viewing?.name ?? ""}
        subtitle="Détail de l'article"
        footer={
          viewing ? (
            <Button
              className="w-full rounded-xl"
              onClick={() => {
                openEdit(viewing);
                setViewingId(null);
              }}
            >
              <Pencil className="mr-1.5 size-4" /> Modifier
            </Button>
          ) : null
        }
      >
        {viewing ? (
          <>
            <DetailField label="Nom" value={viewing.name} />
            <DetailField label="Référence" value={viewing.reference} />
            <DetailField label="TVA" value={taxById(viewing.defaultTaxId)?.name} />
            <DetailField label="Longueur" value={viewing.longueur} />
            <DetailField label="Largeur" value={viewing.largeur} />
            <DetailField label="Hauteur" value={viewing.hauteur} />
            <DetailField label="Prix" value={formatMoney(viewing.price, viewing.currency)} />
            <DetailField label="Prix d'achat" value={formatMoney(viewing.prixAchat, viewing.currency)} />
            <DetailField label="Marge de gain" value={`${viewing.margeGain}%`} />
            <DetailField label="Description" value={viewing.description} />
            <DetailField label="Ajouté le" value={viewing.created?.slice(0, 10)} />
          </>
        ) : null}
      </DetailSheet>
    </AdminLayout>
  );
}
