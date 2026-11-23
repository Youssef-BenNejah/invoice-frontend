import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { FileUp, Loader2, Plus, Save, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout, PageHeader } from "@/components/app/AdminLayout";
import { ArticleSelect } from "@/components/app/ArticleSelect";
import { DocumentPreview } from "@/components/app/DocumentPreview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatMoney, type InvoiceStatus } from "@/lib/mock-data";
import {
  ApiError,
  createInvoice,
  getInvoiceById,
  listClients,
  listCurrencies,
  listFournisseurs,
  listServices,
  listTaxes,
  updateInvoiceApi,
  uploadInvoiceDocument,
  type InvoiceItemPayload,
} from "@/lib/api";
import { apiClientLabel } from "@/lib/invoice-adapter";
import { requireAuth } from "@/lib/route-guards";

const searchSchema = z.object({ type: z.enum(["Standard", "Proforma", "Achat"]).optional(), id: z.string().optional() });

export const Route = createFileRoute("/factures/nouvelle")({
  validateSearch: searchSchema,
  beforeLoad: requireAuth,
  head: () => ({
    meta: [
      { title: "Nouvelle facture" },
      { name: "description", content: "Créez une nouvelle facture standard ou proforma avec calcul automatique." },
    ],
  }),
  component: NouvelleFacture,
});

const documentTypes: InvoiceStatus[] = ["Facture", "Devis", "Bon de livraison"];

type Line = { id: string; productId: string; ref: string; article: string; description: string; quantity: number; price: number; taxId: string };
const emptyLine = (): Line => ({
  id: `l${Date.now()}${Math.random()}`,
  productId: "",
  ref: "",
  article: "",
  description: "",
  quantity: 1,
  price: 0,
  taxId: "",
});

function NouvelleFacture() {
  const { type, id } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: listClients });
  const { data: fournisseurs = [] } = useQuery({ queryKey: ["fournisseurs"], queryFn: listFournisseurs });
  const { data: currencies = [] } = useQuery({ queryKey: ["currencies"], queryFn: listCurrencies });
  const { data: taxes = [] } = useQuery({ queryKey: ["taxes"], queryFn: listTaxes });
  const { data: services = [] } = useQuery({ queryKey: ["services"], queryFn: listServices });
  const { data: editing } = useQuery({
    queryKey: ["invoice", id],
    queryFn: () => getInvoiceById(id as string),
    enabled: !!id,
  });

  const isProforma = editing ? editing.type === "Proforma" : type === "Proforma";
  const isAchat = editing ? editing.type === "Achat" : type === "Achat";

  const [mode, setMode] = useState<"standard" | "import">("standard");
  const [status, setStatus] = useState<InvoiceStatus>("Facture");
  const [client, setClient] = useState("");
  const [fournisseur, setFournisseur] = useState("");
  const [devise, setDevise] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [timbre, setTimbre] = useState(1);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [items, setItems] = useState<Line[]>([emptyLine()]);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (editing && !initialized) {
      setStatus(editing.status);
      if (editing.client) setClient(editing.client.id);
      if (editing.fournisseur) setFournisseur(editing.fournisseur.id);
      setDevise(editing.currency.id);
      setDate(editing.date);
      setTimbre(editing.timbre);
      setFileUrl(editing.factureImage ?? null);
      setItems(
        editing.items.map((it) => ({
          id: it.id,
          productId: it.productId ?? "",
          ref: it.ref ?? "",
          article: it.article,
          description: it.description ?? "",
          quantity: it.quantity,
          price: it.price,
          taxId: it.taxId ?? "",
        })),
      );
      if (editing.factureImage) setMode("import");
      setInitialized(true);
    }
  }, [editing, initialized]);

  useEffect(() => {
    if (!id && !devise && currencies[0]) setDevise(currencies[0].id);
  }, [id, devise, currencies]);
  useEffect(() => {
    if (!id && !isAchat && !client && clients[0]) setClient(clients[0].id);
  }, [id, isAchat, client, clients]);
  useEffect(() => {
    if (!id && isAchat && !fournisseur && fournisseurs[0]) setFournisseur(fournisseurs[0].id);
  }, [id, isAchat, fournisseur, fournisseurs]);

  const defaultTaxId = (taxes.find((t) => t.isDefault) ?? taxes.find((t) => t.taxvalue === 19))?.id ?? "";
  useEffect(() => {
    if (!id && defaultTaxId) {
      setItems((prev) => prev.map((it) => (it.taxId ? it : { ...it, taxId: defaultTaxId })));
    }
  }, [id, defaultTaxId]);

  const selectedDevise = currencies.find((d) => d.id === devise);
  const selectedClient = clients.find((c) => c.id === client);
  const selectedFournisseur = fournisseurs.find((f) => f.id === fournisseur);

  const computedItems = useMemo(
    () =>
      items.map((l) => {
        const tax = taxes.find((t) => t.id === l.taxId);
        const base = l.quantity * l.price;
        const taxAmount = tax ? Math.round(((base * tax.taxvalue) / 100) * 100) / 100 : 0;
        return { ...l, tax, base, taxAmount, lineTotal: base + taxAmount };
      }),
    [items, taxes],
  );

  const sousTotalHT = computedItems.reduce((s, l) => s + l.base, 0);
  const totalTaxes = Math.round(computedItems.reduce((s, l) => s + l.taxAmount, 0) * 100) / 100;
  const totalTTC = sousTotalHT + totalTaxes + timbre;

  const addItem = () => setItems((l) => [...l, { ...emptyLine(), taxId: defaultTaxId }]);
  const removeItem = (id: string) => setItems((l) => (l.length > 1 ? l.filter((x) => x.id !== id) : l));
  const updateItem = (id: string, patch: Partial<Line>) => setItems((l) => l.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  // Picking an article from stock fills the next empty line, or appends a new one if none is free —
  // the selection itself lives above the table, not cramped into each line's own row.
  const addItemFromService = (serviceId: string) => {
    const s = services.find((p) => p.id === serviceId);
    if (!s) return;
    // A vente line defaults to the article's cost price plus its margin, not its raw base price.
    const sellingPrice = Math.round((s.prixAchat + (s.prixAchat * s.margeGain) / 100) * 100) / 100;
    const filled: Partial<Line> = {
      productId: s.id,
      ref: s.reference ?? "",
      article: s.name,
      description: s.description ?? "",
      // An achat line defaults to the article's last known purchase cost (still editable); a vente
      // line defaults to its computed selling price instead.
      price: isAchat ? s.prixAchat : sellingPrice,
      taxId: s.defaultTaxId || defaultTaxId,
    };
    setItems((prev) => {
      const emptyIndex = prev.findIndex((x) => !x.article && !x.productId);
      if (emptyIndex !== -1) {
        return prev.map((x, i) => (i === emptyIndex ? { ...x, ...filled } : x));
      }
      return [...prev, { ...emptyLine(), taxId: defaultTaxId, ...filled }];
    });
  };

  const onError = (err: unknown, fallback: string) => {
    const message = err instanceof ApiError ? err.message : fallback;
    toast.error(fallback, { description: message });
  };

  const createMutation = useMutation({
    mutationFn: createInvoice,
    onSuccess: () => {
      toast.success("Facture enregistrée", {
        description: isAchat ? "Le stock a été mis à jour." : "Vous pouvez la retrouver dans la liste des factures.",
      });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      if (isAchat) queryClient.invalidateQueries({ queryKey: ["services"] });
      navigate({ to: isAchat || isProforma ? "/factures-achats" : "/factures-ventes" });
    },
    onError: (err) => onError(err, "Échec de l'enregistrement"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ invId, payload }: { invId: string; payload: Parameters<typeof updateInvoiceApi>[1] }) => updateInvoiceApi(invId, payload),
    onSuccess: () => {
      toast.success("Facture mise à jour", {
        description: isAchat ? "Le stock a été mis à jour." : "Vous pouvez la retrouver dans la liste des factures.",
      });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      if (editing) queryClient.invalidateQueries({ queryKey: ["invoice", editing.id] });
      if (isAchat) queryClient.invalidateQueries({ queryKey: ["services"] });
      navigate({ to: isAchat || isProforma ? "/factures-achats" : "/factures-ventes" });
    },
    onError: (err) => onError(err, "Échec de la mise à jour"),
  });

  const buildPayload = () => {
    if (isAchat ? !selectedFournisseur : !selectedClient) return null;
    if (!selectedDevise) return null;
    const finalItems: InvoiceItemPayload[] = items.map((l) => ({
      ...(l.productId ? { productId: l.productId } : {}),
      ref: l.ref,
      article: l.article,
      description: l.description,
      quantity: l.quantity,
      price: l.price,
      taxId: l.taxId,
    }));
    return {
      ...(isAchat ? { fournisseurId: selectedFournisseur!.id } : { clientId: selectedClient!.id }),
      currencyId: selectedDevise.id,
      status,
      type: (isAchat ? "Achat" : isProforma ? "Proforma" : "Standard") as "Standard" | "Proforma" | "Achat",
      date,
      timbre,
      items: finalItems,
      factureImage: mode === "import" ? fileUrl : null,
    };
  };

  const persist = () => {
    const payload = buildPayload();
    if (!payload || !payload.items.every((it) => it.article)) {
      toast.error("Formulaire incomplet", {
        description: isAchat ? "Vérifiez le fournisseur, la devise et les articles." : "Vérifiez le client, la devise et les articles.",
      });
      return;
    }
    if (mode === "import" && !payload.factureImage) {
      toast.error("Document manquant", { description: "Importez une image ou un PDF avant d'enregistrer." });
      return;
    }
    if (editing) {
      updateMutation.mutate({ invId: editing.id, payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const pickDocument = async (file: File) => {
    setUploadingFile(true);
    try {
      const { url } = await uploadInvoiceDocument(file);
      setFileUrl(url);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Échec du téléversement";
      toast.error("Échec du téléversement", { description: message });
    } finally {
      setUploadingFile(false);
    }
  };

  const downloadPdf = () => toast("Enregistrez d'abord la facture, puis téléchargez le PDF depuis sa fiche.");

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <AdminLayout>
      <PageHeader
        title={
          editing
            ? `Modifier ${isAchat ? "l'achat" : isProforma ? "la proforma" : "la facture"}`
            : isAchat
              ? "Nouvelle facture d'achat"
              : isProforma
                ? "Nouvelle facture proforma"
                : "Nouvelle facture"
        }
        subtitle={isAchat ? "Le stock sera mis à jour dès l'enregistrement." : "Renseignez les informations et les lignes de facturation."}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="glass rounded-2xl p-5">
            <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
              <TabsList>
                <TabsTrigger value="standard">Facture standard</TabsTrigger>
                <TabsTrigger value="import">Importer un document</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{isAchat ? "Fournisseur" : "Client"}</Label>
                {isAchat ? (
                  <Select value={fournisseur} onValueChange={setFournisseur}>
                    <SelectTrigger className="h-10 rounded-xl">
                      <SelectValue placeholder="Choisir un fournisseur…" />
                    </SelectTrigger>
                    <SelectContent>
                      {fournisseurs.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.nom}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Select value={client} onValueChange={setClient}>
                    <SelectTrigger className="h-10 rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {clients.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {apiClientLabel(c)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {isAchat && fournisseurs.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Aucun fournisseur — créez-en un depuis la page Fournisseurs.</p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label>Type de document</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as InvoiceStatus)}>
                  <SelectTrigger className="h-10 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {documentTypes.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Devise</Label>
                <Select value={devise} onValueChange={setDevise}>
                  <SelectTrigger className="h-10 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {currencies.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.code} — {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Timbre fiscal</Label>
                <Input type="number" min={0} step="0.001" value={timbre} onChange={(e) => setTimbre(Number(e.target.value))} className="h-10 rounded-xl" />
              </div>
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10 rounded-xl" />
              </div>
            </div>
          </div>

          {mode === "import" ? (
            <div className="glass space-y-4 rounded-2xl p-8">
              {fileUrl ? (
                <div className="space-y-3">
                  <DocumentPreview url={fileUrl} />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-xl"
                    onClick={() => setFileUrl(null)}
                  >
                    <X className="mr-1.5 size-3.5" /> Retirer le document
                  </Button>
                </div>
              ) : (
                <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border/70 py-14 text-center transition-colors hover:border-ocean/50 hover:bg-ice/30 dark:hover:bg-white/5">
                  <span className="grid size-14 place-items-center rounded-2xl bg-ocean/10 text-ocean dark:text-sky">
                    {uploadingFile ? <Loader2 className="size-6 animate-spin" /> : <FileUp className="size-6" />}
                  </span>
                  <span className="text-sm font-medium">
                    {uploadingFile ? "Téléversement…" : "Cliquez pour importer une image ou un PDF"}
                  </span>
                  <span className="text-xs text-muted-foreground">JPG, PNG ou PDF · 8 Mo max</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,application/pdf"
                    className="hidden"
                    disabled={uploadingFile}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) pickDocument(file);
                    }}
                  />
                </label>
              )}
            </div>
          ) : null}

          <div className="glass overflow-hidden rounded-2xl">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 p-5">
                <h2 className="text-base font-semibold">{isAchat ? "Lignes d'achat" : "Lignes de facturation"}</h2>
                <div className="flex items-center gap-2">
                  <div className="w-64">
                    <ArticleSelect
                      value=""
                      services={services}
                      onSelect={(s) => addItemFromService(s.id)}
                      placeholder="Ajouter depuis le stock…"
                    />
                  </div>
                  <Button size="sm" variant="outline" className="shrink-0 rounded-xl" onClick={addItem}>
                    <Plus className="mr-1 size-4" /> Ajouter une ligne
                  </Button>
                </div>
              </div>
              <div className="divide-y divide-border/50">
                {computedItems.map((l) => (
                  <div key={l.id} className="grid gap-3 p-4 sm:grid-cols-12 sm:items-start">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-xs">Article</Label>
                      <Input
                        value={l.article}
                        onChange={(e) => updateItem(l.id, { article: e.target.value, productId: "" })}
                        placeholder="Nom de l'article"
                        className="h-9 rounded-lg text-sm"
                      />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-xs">Réf</Label>
                      <Input value={l.ref} onChange={(e) => updateItem(l.id, { ref: e.target.value })} className="h-9 rounded-lg text-sm" />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-xs">Description</Label>
                      <Input
                        value={l.description}
                        onChange={(e) => updateItem(l.id, { description: e.target.value })}
                        className="h-9 rounded-lg text-sm"
                      />
                    </div>
                    <div className="space-y-1.5 sm:col-span-1">
                      <Label className="text-xs">Qté</Label>
                      <Input
                        type="number"
                        min={1}
                        value={l.quantity}
                        onChange={(e) => updateItem(l.id, { quantity: Number(e.target.value) })}
                        className="h-9 rounded-lg text-sm"
                      />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-xs">{isAchat ? "PU d'achat" : "PU"}</Label>
                      <Input
                        type="number"
                        min={0}
                        value={l.price}
                        onChange={(e) => updateItem(l.id, { price: Number(e.target.value) })}
                        className="h-9 rounded-lg text-sm"
                      />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-xs">TVA</Label>
                      <Select value={l.taxId} onValueChange={(v) => updateItem(l.id, { taxId: v })}>
                        <SelectTrigger className="h-9 rounded-lg text-sm">
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
                    <div className="flex items-center justify-between gap-2 sm:col-span-1">
                      <div>
                        <Label className="text-xs">Total HT</Label>
                        <p className="text-sm font-semibold">{formatMoney(l.base, selectedDevise?.code)}</p>
                      </div>
                      <Button variant="ghost" size="icon" className="size-8 shrink-0 rounded-lg text-destructive hover:text-destructive" onClick={() => removeItem(l.id)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
          </div>
        </div>

        <div className="lg:sticky lg:top-20 lg:h-fit">
          <div className="glass rounded-2xl p-5">
            <h2 className="text-base font-semibold">Récapitulatif</h2>
            <div className="mt-4 space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total HT</span>
                <span className="font-medium">{formatMoney(sousTotalHT, selectedDevise?.code)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total TVA</span>
                <span className="font-medium">{formatMoney(totalTaxes, selectedDevise?.code)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Timbre fiscal</span>
                <span className="font-medium">{formatMoney(timbre, selectedDevise?.code)}</span>
              </div>
              <div className="my-2 h-px bg-border" />
              <div className="flex justify-between text-base">
                <span className="font-semibold">Total TTC</span>
                <span className="font-bold text-gradient-ocean">{formatMoney(totalTTC, selectedDevise?.code)}</span>
              </div>
            </div>

            <div className="mt-6 space-y-2">
              <Button className="w-full rounded-xl" onClick={persist} disabled={saving || uploadingFile}>
                <Save className="mr-1.5 size-4" /> {editing ? "Enregistrer" : "Enregistrer la facture"}
              </Button>
              <Button variant="ghost" className="w-full rounded-xl" onClick={downloadPdf}>
                <Upload className="mr-1.5 size-4 rotate-180" /> Télécharger le PDF
              </Button>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
