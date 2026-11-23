import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Pencil, Plus, Trash2, Undo2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout, PageHeader } from "@/components/app/AdminLayout";
import { DataTable, type Column } from "@/components/app/DataTable";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { formatDate, formatMoney } from "@/lib/mock-data";
import {
  ApiError,
  createDepenseNote,
  deleteDepenseNote,
  listDepenseNotes,
  updateDepenseNote,
  updateDepenseNoteStatus,
  type ApiDepenseNote,
  type ApiNoteStatus,
  type DepenseNotePayload,
} from "@/lib/api";
import { requireAuth } from "@/lib/route-guards";

export const Route = createFileRoute("/depenses")({
  beforeLoad: requireAuth,
  head: () => ({
    meta: [
      { title: "Dépenses" },
      { name: "description", content: "Suivez ce que vous devez encore payer à vos fournisseurs." },
    ],
  }),
  component: Depenses,
});

const DEFAULT_CURRENCY = "TND";

type NoteFormState = DepenseNotePayload;
const emptyNoteForm = (): NoteFormState => ({
  fournisseurNom: "",
  telephone: "",
  montant: 0,
  date: new Date().toISOString().slice(0, 10),
  status: "NON_PAYE",
  description: "",
});
const noteStatusLabel: Record<ApiNoteStatus, string> = { NON_PAYE: "impayé", PAYE: "Payé" };

function Depenses() {
  const queryClient = useQueryClient();
  const { data: notes = [], isLoading: notesLoading, isError: notesError } = useQuery({
    queryKey: ["depense-notes"],
    queryFn: listDepenseNotes,
  });

  const [noteOpen, setNoteOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<ApiDepenseNote | null>(null);
  const [noteForm, setNoteForm] = useState<NoteFormState>(emptyNoteForm());

  const invalidateNotes = () => queryClient.invalidateQueries({ queryKey: ["depense-notes"] });

  const onError = (err: unknown, fallback: string) => {
    const message = err instanceof ApiError ? err.message : fallback;
    toast.error(fallback, { description: message });
  };

  const totalAPayer = useMemo(
    () => notes.filter((n) => n.status === "NON_PAYE").reduce((sum, n) => sum + n.montant, 0),
    [notes],
  );

  const createNoteMutation = useMutation({
    mutationFn: createDepenseNote,
    onSuccess: () => {
      toast.success("Note ajoutée");
      setNoteOpen(false);
      invalidateNotes();
    },
    onError: (err) => onError(err, "Échec de la création de la note"),
  });

  const updateNoteMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: DepenseNotePayload }) => updateDepenseNote(id, payload),
    onSuccess: () => {
      toast.success("Note mise à jour");
      setNoteOpen(false);
      invalidateNotes();
    },
    onError: (err) => onError(err, "Échec de la mise à jour de la note"),
  });

  const updateNoteStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ApiNoteStatus }) => updateDepenseNoteStatus(id, status),
    onSuccess: () => {
      toast.success("Statut mis à jour");
      invalidateNotes();
    },
    onError: (err) => onError(err, "Échec de la mise à jour du statut"),
  });

  const deleteNoteMutation = useMutation({
    mutationFn: deleteDepenseNote,
    onSuccess: () => {
      toast("Note supprimée");
      invalidateNotes();
    },
    onError: (err) => onError(err, "Échec de la suppression de la note"),
  });

  const openCreateNote = () => {
    setEditingNote(null);
    setNoteForm(emptyNoteForm());
    setNoteOpen(true);
  };

  const openEditNote = (n: ApiDepenseNote) => {
    setEditingNote(n);
    setNoteForm({
      fournisseurNom: n.fournisseurNom ?? "",
      telephone: n.telephone ?? "",
      montant: n.montant,
      date: n.date ? n.date.slice(0, 10) : "",
      status: n.status,
      description: n.description ?? "",
    });
    setNoteOpen(true);
  };

  const saveNote = () => {
    const { date, ...rest } = noteForm;
    const payload: DepenseNotePayload = {
      ...rest,
      ...(date ? { date: new Date(date).toISOString() } : {}),
    };
    if (editingNote) {
      updateNoteMutation.mutate({ id: editingNote.id, payload });
    } else {
      createNoteMutation.mutate(payload);
    }
  };

  const toggleNoteStatus = (n: ApiDepenseNote) =>
    updateNoteStatusMutation.mutate({ id: n.id, status: n.status === "PAYE" ? "NON_PAYE" : "PAYE" });

  const removeNote = (n: ApiDepenseNote) => deleteNoteMutation.mutate(n.id);

  const noteColumns: Column<ApiDepenseNote>[] = [
    {
      key: "fournisseur",
      header: "Fournisseur",
      sortable: true,
      sortValue: (r) => r.fournisseurNom ?? "",
      cell: (r) => <span className="font-medium">{r.fournisseurNom || ""}</span>,
    },
    { key: "telephone", header: "Téléphone", cell: (r) => <span className="text-muted-foreground">{r.telephone || ""}</span> },
    {
      key: "montant",
      header: "Montant à payer",
      className: "text-right",
      sortable: true,
      sortValue: (r) => r.montant,
      cell: (r) => <span className="font-semibold">{formatMoney(r.montant, DEFAULT_CURRENCY)}</span>,
    },
    {
      key: "date",
      header: "Date",
      sortable: true,
      sortValue: (r) => r.date ?? "",
      cell: (r) => <span className="text-muted-foreground">{r.date ? formatDate(r.date) : ""}</span>,
    },
    { key: "status", header: "Statut", cell: (r) => <StatusBadge status={noteStatusLabel[r.status]} /> },
    { key: "description", header: "Description", cell: (r) => <span className="text-muted-foreground">{r.description || ""}</span> },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (r) => (
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" size="icon" className="size-8 rounded-lg" title={r.status === "PAYE" ? "Marquer impayé" : "Marquer payé"} onClick={() => toggleNoteStatus(r)}>
            {r.status === "PAYE" ? <Undo2 className="size-4" /> : <CheckCircle2 className="size-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="size-8 rounded-lg" onClick={() => openEditNote(r)}>
            <Pencil className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-8 rounded-lg text-destructive hover:text-destructive" onClick={() => removeNote(r)}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <AdminLayout>
      <PageHeader
        title="Dépenses"
        subtitle="Suivez ce que vous devez encore payer à vos fournisseurs."
        actions={
          <Button className="rounded-xl" onClick={openCreateNote}>
            <Plus className="mr-1.5 size-4" /> Nouvelle note
          </Button>
        }
      />

      {notesError ? (
        <div className="mb-6 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Impossible de charger les notes, vérifiez que le serveur backend est démarré.
        </div>
      ) : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Wallet className="size-4" />
            Total à payer
          </div>
          <p className="mt-2 text-2xl font-semibold">{formatMoney(totalAPayer, DEFAULT_CURRENCY)}</p>
        </div>
      </div>

      <DataTable
        rows={notes}
        columns={noteColumns}
        searchKeys={(r) => `${r.fournisseurNom ?? ""} ${r.telephone ?? ""} ${r.description ?? ""}`}
        searchPlaceholder="Rechercher une note…"
        emptyTitle={notesLoading ? "Chargement…" : "Aucune note"}
      />

      <Sheet open={noteOpen} onOpenChange={setNoteOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{editingNote ? "Modifier la note" : "Nouvelle note"}</SheetTitle>
            <SheetDescription>Montant dû à un fournisseur, pas encore payé.</SheetDescription>
          </SheetHeader>
          <div className="mt-6 grid gap-4">
            <div className="space-y-2">
              <Label>Fournisseur</Label>
              <Input
                value={noteForm.fournisseurNom}
                onChange={(e) => setNoteForm({ ...noteForm, fournisseurNom: e.target.value })}
                className="rounded-xl"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Téléphone</Label>
                <Input
                  value={noteForm.telephone}
                  onChange={(e) => setNoteForm({ ...noteForm, telephone: e.target.value })}
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-2">
                <Label>Montant à payer</Label>
                <Input
                  type="number"
                  value={noteForm.montant}
                  onChange={(e) => setNoteForm({ ...noteForm, montant: Number(e.target.value) })}
                  className="rounded-xl"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={noteForm.date ?? ""}
                  onChange={(e) => setNoteForm({ ...noteForm, date: e.target.value })}
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-2">
                <Label>Statut</Label>
                <Select
                  value={noteForm.status ?? "NON_PAYE"}
                  onValueChange={(v) => setNoteForm({ ...noteForm, status: v as ApiNoteStatus })}
                >
                  <SelectTrigger className="h-10 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NON_PAYE">Non payé</SelectItem>
                    <SelectItem value="PAYE">Payé</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={noteForm.description}
                onChange={(e) => setNoteForm({ ...noteForm, description: e.target.value })}
                className="rounded-xl"
              />
            </div>
          </div>
          <SheetFooter className="mt-6">
            <Button variant="outline" className="rounded-xl" onClick={() => setNoteOpen(false)}>
              Annuler
            </Button>
            <Button
              className="rounded-xl"
              onClick={saveNote}
              disabled={createNoteMutation.isPending || updateNoteMutation.isPending}
            >
              Enregistrer
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </AdminLayout>
  );
}
