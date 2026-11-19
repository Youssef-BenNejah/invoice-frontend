import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout, PageHeader } from "@/components/app/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatMoney } from "@/lib/mock-data";
import {
  ApiError,
  createAchat,
  listCurrencies,
  listFournisseurs,
  listServices,
  listTaxes,
  RETENUE_SOURCE_RATES,
  type AchatItemPayload,
} from "@/lib/api";
import { requireAuth } from "@/lib/route-guards";

export const Route = createFileRoute("/achats_/nouvelle")({
  beforeLoad: requireAuth,
  head: () => ({
    meta: [
      { title: "Nouvel achat — Harmonie-dev" },
      { name: "description", content: "Enregistrez un achat fournisseur : le stock est mis à jour immédiatement." },
    ],
  }),
  component: NouvelAchat,
});

type Line = { id: string; productId: string; quantity: number; unitPriceHT: number; taxId: string };
const emptyLine = (): Line => ({ id: `l${Date.now()}${Math.random()}`, productId: "", quantity: 1, unitPriceHT: 0, taxId: "" });

function NouvelAchat() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: fournisseurs = [] } = useQuery({ queryKey: ["fournisseurs"], queryFn: listFournisseurs });
  const { data: currencies = [] } = useQuery({ queryKey: ["currencies"], queryFn: listCurrencies });
  const { data: taxes = [] } = useQuery({ queryKey: ["taxes"], queryFn: listTaxes });
  const { data: services = [] } = useQuery({ queryKey: ["services"], queryFn: listServices });

  const [fournisseurId, setFournisseurId] = useState("");
  const [devise, setDevise] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [retenueSourceRate, setRetenueSourceRate] = useState(0);
  const [items, setItems] = useState<Line[]>([emptyLine()]);

  useEffect(() => {
    if (!devise && currencies[0]) setDevise(currencies[0].id);
  }, [devise, currencies]);
  useEffect(() => {
    if (!fournisseurId && fournisseurs[0]) setFournisseurId(fournisseurs[0].id);
  }, [fournisseurId, fournisseurs]);

  const selectedDevise = currencies.find((d) => d.id === devise);

  const computedItems = useMemo(
    () =>
      items.map((l) => {
        const tax = taxes.find((t) => t.id === l.taxId);
        const base = l.quantity * l.unitPriceHT;
        const taxAmount = tax ? Math.round(((base * tax.taxvalue) / 100) * 100) / 100 : 0;
        const product = services.find((s) => s.id === l.productId);
        return { ...l, tax, product, base, taxAmount, lineTotal: base + taxAmount };
      }),
    [items, taxes, services],
  );

  const sousTotalHT = computedItems.reduce((s, l) => s + l.base, 0);
  const totalTaxes = Math.round(computedItems.reduce((s, l) => s + l.taxAmount, 0) * 100) / 100;
  const totalTTC = sousTotalHT + totalTaxes;
  const retenueSourceAmount = Math.round(((totalTTC * retenueSourceRate) / 100) * 100) / 100;
  const montantNetAPayer = Math.round((totalTTC - retenueSourceAmount) * 100) / 100;

  const addItem = () => setItems((l) => [...l, emptyLine()]);
  const removeItem = (id: string) => setItems((l) => (l.length > 1 ? l.filter((x) => x.id !== id) : l));
  const updateItem = (id: string, patch: Partial<Line>) => setItems((l) => l.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const onError = (err: unknown, fallback: string) => {
    const message = err instanceof ApiError ? err.message : fallback;
    toast.error(fallback, { description: message });
  };

  const createMutation = useMutation({
    mutationFn: createAchat,
    onSuccess: () => {
      toast.success("Achat enregistré", { description: "Le stock a été mis à jour." });
      queryClient.invalidateQueries({ queryKey: ["achats"] });
      queryClient.invalidateQueries({ queryKey: ["services"] });
      navigate({ to: "/achats" });
    },
    onError: (err) => onError(err, "Échec de l'enregistrement"),
  });

  const persist = () => {
    if (!fournisseurId || !selectedDevise) {
      toast.error("Formulaire incomplet", { description: "Choisissez un fournisseur et une devise." });
      return;
    }
    if (items.some((l) => !l.productId || l.quantity <= 0)) {
      toast.error("Lignes incomplètes", { description: "Chaque ligne doit référencer un produit avec une quantité positive." });
      return;
    }
    const payloadItems: AchatItemPayload[] = items.map((l) => ({
      productId: l.productId,
      quantity: l.quantity,
      unitPriceHT: l.unitPriceHT,
      ...(l.taxId ? { taxId: l.taxId } : {}),
    }));
    createMutation.mutate({
      fournisseurId,
      currencyId: selectedDevise.id,
      date,
      note,
      retenueSourceRate,
      items: payloadItems,
    });
  };

  return (
    <AdminLayout>
      <PageHeader title="Nouvel achat" subtitle="Enregistrer une facture d'achat fournisseur — le stock est mis à jour immédiatement." />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="glass rounded-2xl p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Fournisseur</Label>
                <Select value={fournisseurId} onValueChange={setFournisseurId}>
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
                {fournisseurs.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Aucun fournisseur — créez-en un depuis la page Fournisseurs.
                  </p>
                ) : null}
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
                <Label>Date</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10 rounded-xl" />
              </div>
              <div className="space-y-2">
                <Label>Retenue à la source</Label>
                <Select value={String(retenueSourceRate)} onValueChange={(v) => setRetenueSourceRate(Number(v))}>
                  <SelectTrigger className="h-10 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RETENUE_SOURCE_RATES.map((r) => (
                      <SelectItem key={r} value={String(r)}>
                        {r === 0 ? "Aucune" : `${r}%`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {retenueSourceRate === 0 && totalTTC >= 1000 ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Montant ≥ 1000 TND — une retenue à la source (souvent 1,5%) est généralement applicable.
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="glass overflow-hidden rounded-2xl">
            <div className="flex items-center justify-between border-b border-border/60 p-5">
              <h2 className="text-base font-semibold">Lignes d'achat</h2>
              <Button size="sm" variant="outline" className="rounded-xl" onClick={addItem}>
                <Plus className="mr-1 size-4" /> Ajouter une ligne
              </Button>
            </div>
            <div className="divide-y divide-border/50">
              {computedItems.map((l) => (
                <div key={l.id} className="grid gap-3 p-4 sm:grid-cols-12 sm:items-end">
                  <div className="space-y-1.5 sm:col-span-4">
                    <Label className="text-xs">Produit</Label>
                    <Select value={l.productId} onValueChange={(v) => updateItem(l.id, { productId: v })}>
                      <SelectTrigger className="h-9 rounded-lg text-sm">
                        <SelectValue placeholder="Choisir un produit…" />
                      </SelectTrigger>
                      <SelectContent>
                        {services.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name} — stock actuel : {s.stockQuantity}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label className="text-xs">Quantité</Label>
                    <Input
                      type="number"
                      min={1}
                      value={l.quantity}
                      onChange={(e) => updateItem(l.id, { quantity: Number(e.target.value) })}
                      className="h-9 rounded-lg text-sm"
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label className="text-xs">Prix unitaire HT</Label>
                    <Input
                      type="number"
                      min={0}
                      value={l.unitPriceHT}
                      onChange={(e) => updateItem(l.id, { unitPriceHT: Number(e.target.value) })}
                      className="h-9 rounded-lg text-sm"
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label className="text-xs">Taxe</Label>
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
                  <div className="flex items-center justify-between gap-2 sm:col-span-2">
                    <span className="text-sm font-semibold">{formatMoney(l.lineTotal, selectedDevise?.code)}</span>
                    <Button variant="ghost" size="icon" className="size-8 shrink-0 rounded-lg text-destructive hover:text-destructive" onClick={() => removeItem(l.id)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-border/60 p-5">
              <Label>Note</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} className="mt-2 rounded-xl" placeholder="Bon de livraison, référence fournisseur…" />
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
                <span className="text-muted-foreground">Total taxes</span>
                <span className="font-medium">{formatMoney(totalTaxes, selectedDevise?.code)}</span>
              </div>
              <div className="my-2 h-px bg-border" />
              <div className="flex justify-between text-base">
                <span className="font-semibold">Total TTC</span>
                <span className="font-bold text-gradient-ocean">{formatMoney(totalTTC, selectedDevise?.code)}</span>
              </div>
              {retenueSourceRate > 0 ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Retenue à la source ({retenueSourceRate}%)</span>
                    <span className="font-medium text-destructive">-{formatMoney(retenueSourceAmount, selectedDevise?.code)}</span>
                  </div>
                  <div className="my-2 h-px bg-border" />
                  <div className="flex justify-between text-base">
                    <span className="font-semibold">Net à payer</span>
                    <span className="font-bold">{formatMoney(montantNetAPayer, selectedDevise?.code)}</span>
                  </div>
                </>
              ) : null}
            </div>
            <p className="mt-4 rounded-xl bg-ice px-3 py-2.5 text-xs text-muted-foreground dark:bg-white/5">
              Le stock HT (hors taxe) sert de base au coût moyen pondéré — sauf si votre entreprise n'est pas assujettie à la TVA (voir Ma entreprise), auquel cas la TVA non récupérable s'ajoute au coût.
            </p>
            <div className="mt-6">
              <Button className="w-full rounded-xl" onClick={persist} disabled={createMutation.isPending}>
                <Save className="mr-1.5 size-4" /> Enregistrer l'achat
              </Button>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
