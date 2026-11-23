import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Pencil, Plus, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout, PageHeader } from "@/components/app/AdminLayout";
import { DataTable, type Column } from "@/components/app/DataTable";
import { DetailField, DetailSheet } from "@/components/app/DetailSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import {
  ApiError,
  createFournisseur,
  deleteFournisseur,
  getFournisseurById,
  listFournisseurs,
  updateFournisseur,
  type ApiFournisseur,
  type FournisseurPayload,
} from "@/lib/api";
import { requireAuth } from "@/lib/route-guards";

export const Route = createFileRoute("/fournisseurs")({
  beforeLoad: requireAuth,
  head: () => ({
    meta: [
      { title: "Fournisseurs" },
      { name: "description", content: "Vos fournisseurs pour les achats qui alimentent le stock." },
    ],
  }),
  component: Fournisseurs,
});

type FormState = FournisseurPayload;
const emptyForm: FormState = { nom: "", email: "", telephone: "", fisc: "", adresse: "" };

function Fournisseurs() {
  const queryClient = useQueryClient();
  const { data: rows = [], isLoading, isError } = useQuery({ queryKey: ["fournisseurs"], queryFn: listFournisseurs });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ApiFournisseur | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [viewingId, setViewingId] = useState<string | null>(null);

  const { data: viewing } = useQuery({
    queryKey: ["fournisseur", viewingId],
    queryFn: () => getFournisseurById(viewingId as string),
    enabled: !!viewingId,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["fournisseurs"] });

  const onError = (err: unknown, fallback: string) => {
    const message = err instanceof ApiError ? err.message : fallback;
    toast.error(fallback, { description: message });
  };

  const createMutation = useMutation({
    mutationFn: createFournisseur,
    onSuccess: (f) => {
      toast.success("Fournisseur ajouté", { description: f.nom });
      setOpen(false);
      invalidate();
    },
    onError: (err) => onError(err, "Échec de la création"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: FournisseurPayload }) => updateFournisseur(id, payload),
    onSuccess: (f) => {
      toast.success("Fournisseur mis à jour", { description: f.nom });
      setOpen(false);
      invalidate();
    },
    onError: (err) => onError(err, "Échec de la mise à jour"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteFournisseur,
    onSuccess: (_data, id) => {
      const f = rows.find((r) => r.id === id);
      toast("Fournisseur supprimé", { description: f?.nom });
      invalidate();
    },
    onError: (err) => onError(err, "Échec de la suppression"),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (f: ApiFournisseur) => {
    setEditing(f);
    setForm({ nom: f.nom, email: f.email ?? "", telephone: f.telephone ?? "", fisc: f.fisc ?? "", adresse: f.adresse ?? "" });
    setOpen(true);
  };

  const save = () => {
    if (editing) {
      updateMutation.mutate({ id: editing.id, payload: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const remove = (f: ApiFournisseur) => {
    deleteMutation.mutate(f.id);
  };

  const columns: Column<ApiFournisseur>[] = [
    {
      key: "nom",
      header: "Fournisseur",
      sortable: true,
      sortValue: (r) => r.nom,
      cell: (r) => (
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-ocean/10 text-ocean dark:text-sky">
            <Truck className="size-4" />
          </span>
          <div>
            <p className="font-medium">{r.nom}</p>
            {r.fisc ? <p className="text-xs text-muted-foreground">MF {r.fisc}</p> : null}
          </div>
        </div>
      ),
    },
    {
      key: "email",
      header: "E-mail",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.email || ""}</span>,
    },
    {
      key: "telephone",
      header: "Téléphone",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.telephone || ""}</span>,
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
          <Button variant="ghost" size="icon" className="size-8 rounded-lg" onClick={() => openEdit(r)}>
            <Pencil className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-8 rounded-lg text-destructive hover:text-destructive" onClick={() => remove(r)}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <AdminLayout>
      <PageHeader
        title="Fournisseurs"
        subtitle="Vos fournisseurs pour les achats qui alimentent le stock."
        actions={
          <Button className="rounded-xl" onClick={openCreate}>
            <Plus className="mr-1.5 size-4" /> Nouveau fournisseur
          </Button>
        }
      />

      {isError ? (
        <div className="mb-6 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Impossible de charger les fournisseurs. Vérifiez que le serveur backend est démarré.
        </div>
      ) : null}

      <DataTable
        rows={rows}
        columns={columns}
        searchKeys={(r) => `${r.nom} ${r.email ?? ""} ${r.fisc ?? ""}`}
        searchPlaceholder="Rechercher un fournisseur…"
        emptyTitle={isLoading ? "Chargement…" : "Aucun fournisseur"}
      />

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{editing ? "Modifier le fournisseur" : "Nouveau fournisseur"}</SheetTitle>
            <SheetDescription>Coordonnées du fournisseur pour vos factures d'achat.</SheetDescription>
          </SheetHeader>
          <div className="mt-6 grid gap-4">
            <div className="space-y-2">
              <Label>Nom</Label>
              <Input value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} className="rounded-xl" />
            </div>
            <div className="space-y-2">
              <Label>Matricule fiscal</Label>
              <Input value={form.fisc} onChange={(e) => setForm({ ...form, fisc: e.target.value })} className="rounded-xl" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>E-mail</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded-xl" />
              </div>
              <div className="space-y-2">
                <Label>Téléphone</Label>
                <Input value={form.telephone} onChange={(e) => setForm({ ...form, telephone: e.target.value })} className="rounded-xl" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Adresse</Label>
              <Input value={form.adresse} onChange={(e) => setForm({ ...form, adresse: e.target.value })} className="rounded-xl" />
            </div>
          </div>
          <SheetFooter className="mt-6">
            <Button variant="outline" className="rounded-xl" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button
              className="rounded-xl"
              onClick={save}
              disabled={!form.nom || createMutation.isPending || updateMutation.isPending}
            >
              Enregistrer
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <DetailSheet
        open={!!viewingId}
        onOpenChange={(o) => !o && setViewingId(null)}
        icon={<Truck className="size-5 text-ocean" />}
        title={viewing?.nom ?? ""}
        subtitle="Détail du fournisseur"
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
            <DetailField label="Nom" value={viewing.nom} />
            <DetailField label="Matricule fiscal" value={viewing.fisc} />
            <DetailField label="E-mail" value={viewing.email} />
            <DetailField label="Téléphone" value={viewing.telephone} />
            <DetailField label="Adresse" value={viewing.adresse} />
            <DetailField label="Ajouté le" value={viewing.created?.slice(0, 10)} />
          </>
        ) : null}
      </DetailSheet>
    </AdminLayout>
  );
}
