import { CountrySelect } from "@/components/app/CountrySelect";
import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Save, Scale, Upload } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout, PageHeader } from "@/components/app/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ApiError,
  getMyCompany,
  updateMyCompany,
  uploadCompanyLogo,
  type ApiCompany,
  type CompanyPayload,
} from "@/lib/api";
import { requireAuth } from "@/lib/route-guards";

export const Route = createFileRoute("/mon-entreprise")({
  beforeLoad: requireAuth,
  head: () => ({
    meta: [
      { title: "Ma entreprise — Harmonie-dev" },
      { name: "description", content: "Configurez les informations de votre entreprise utilisées sur vos factures." },
    ],
  }),
  component: MonEntreprise,
});

const emptyForm: CompanyPayload = {
  name: "",
  matriculeFisc: "",
  address: "",
  state: "",
  country: "",
  email: "",
  phone: "",
  website: "",
  taxNumber: "",
  vatNumber: "",
  registrationNumber: "",
  assujettiTva: true,
  regimeFiscal: "Réel",
};

const REGIMES_FISCAUX = ["Réel", "Forfaitaire", "Suspension TVA"];

function toForm(c: ApiCompany): CompanyPayload {
  return {
    name: c.name,
    matriculeFisc: c.matriculeFisc ?? "",
    address: c.address ?? "",
    state: c.state ?? "",
    country: c.country ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    website: c.website ?? "",
    taxNumber: c.taxNumber ?? "",
    vatNumber: c.vatNumber ?? "",
    registrationNumber: c.registrationNumber ?? "",
    assujettiTva: c.assujettiTva,
    regimeFiscal: c.regimeFiscal ?? "Réel",
  };
}

function MonEntreprise() {
  const queryClient = useQueryClient();
  const { data: company, isLoading, isError } = useQuery({ queryKey: ["company"], queryFn: getMyCompany });

  const [form, setForm] = useState<CompanyPayload>(emptyForm);

  useEffect(() => {
    if (company) setForm(toForm(company));
  }, [company]);

  const onError = (err: unknown, fallback: string) => {
    const message = err instanceof ApiError ? err.message : fallback;
    toast.error(fallback, { description: message });
  };

  const updateMutation = useMutation({
    mutationFn: updateMyCompany,
    onSuccess: (c) => {
      toast.success("Entreprise mise à jour", { description: c.name });
      queryClient.setQueryData(["company"], c);
    },
    onError: (err) => onError(err, "Échec de la mise à jour"),
  });

  const logoMutation = useMutation({
    mutationFn: uploadCompanyLogo,
    onSuccess: (c) => {
      toast.success("Logo mis à jour");
      queryClient.setQueryData(["company"], c);
    },
    onError: (err) => onError(err, "Échec de l'envoi du logo"),
  });

  type TextField = Exclude<keyof CompanyPayload, "assujettiTva">;
  const field = (key: TextField) => ({
    value: form[key] ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value }),
  });

  const onLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    logoMutation.mutate(file);
    e.target.value = "";
  };

  return (
    <AdminLayout>
      <PageHeader title="Ma entreprise" subtitle="Ces informations apparaissent sur vos factures PDF." />

      {isError ? (
        <div className="mb-6 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Impossible de charger les informations de l'entreprise — vérifiez que le serveur backend est démarré.
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="glass rounded-2xl p-6 lg:col-span-2">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Building2 className="size-4 text-ocean" /> Informations générales
          </h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Raison sociale</Label>
              <Input {...field("name")} className="rounded-xl" disabled={isLoading} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Matricule fiscal</Label>
              <Input {...field("matriculeFisc")} className="rounded-xl" disabled={isLoading} />
              <p className="text-xs text-muted-foreground">Imprimé en en-tête de chaque facture PDF.</p>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Adresse</Label>
              <Input {...field("address")} className="rounded-xl" disabled={isLoading} />
            </div>
            <div className="space-y-2">
              <Label>Gouvernorat / État</Label>
              <Input {...field("state")} className="rounded-xl" disabled={isLoading} />
            </div>
            <div className="space-y-2">
              <Label>Pays</Label>
              <CountrySelect value={form.country ?? ""} onChange={(country) => setForm({ ...form, country })} disabled={isLoading} />
            </div>
            <div className="space-y-2">
              <Label>E-mail</Label>
              <Input type="email" {...field("email")} className="rounded-xl" disabled={isLoading} />
            </div>
            <div className="space-y-2">
              <Label>Téléphone</Label>
              <Input {...field("phone")} className="rounded-xl" disabled={isLoading} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Site web</Label>
              <Input {...field("website")} className="rounded-xl" disabled={isLoading} />
            </div>
            <div className="space-y-2">
              <Label>Numéro fiscal</Label>
              <Input {...field("taxNumber")} className="rounded-xl" disabled={isLoading} />
            </div>
            <div className="space-y-2">
              <Label>N° TVA</Label>
              <Input {...field("vatNumber")} className="rounded-xl" disabled={isLoading} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>N° d'immatriculation</Label>
              <Input {...field("registrationNumber")} className="rounded-xl" disabled={isLoading} />
            </div>
          </div>

          <h2 className="mt-8 flex items-center gap-2 text-base font-semibold">
            <Scale className="size-4 text-ocean" /> Régime fiscal
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Détermine si la TVA payée sur vos achats est récupérable ou doit entrer dans le coût du stock.
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-xl border border-border/60 px-3.5 py-3 sm:col-span-2">
              <div>
                <Label className="text-sm">Assujetti à la TVA</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Si désactivé, la TVA sur vos achats n'est pas récupérable et s'ajoute au coût d'acquisition du stock.
                </p>
              </div>
              <Switch
                checked={form.assujettiTva}
                onCheckedChange={(v) => setForm({ ...form, assujettiTva: v })}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Régime</Label>
              <Select
                value={form.regimeFiscal ?? "Réel"}
                onValueChange={(v) => setForm({ ...form, regimeFiscal: v })}
                disabled={isLoading}
              >
                <SelectTrigger className="h-10 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REGIMES_FISCAUX.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Informatif — utilisé dans le rapport fiscal (Rapports).</p>
            </div>
          </div>

          <Button
            className="mt-6 rounded-xl"
            onClick={() => updateMutation.mutate(form)}
            disabled={!form.name || isLoading || updateMutation.isPending}
          >
            <Save className="mr-1.5 size-4" /> Enregistrer les modifications
          </Button>
        </div>

        <div className="glass h-fit rounded-2xl p-6">
          <h2 className="text-base font-semibold">Logo</h2>
          <p className="mt-1 text-sm text-muted-foreground">Utilisé en en-tête de vos factures PDF.</p>
          <label className="mt-4 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border/70 py-10 text-center transition-colors hover:border-ocean/50 hover:bg-ice/30 dark:hover:bg-white/5">
            {company?.logoUrl ? (
              <img src={company.logoUrl} alt="Logo" className="size-20 rounded-2xl object-cover shadow-sm" />
            ) : (
              <span className="grid size-16 place-items-center rounded-2xl bg-ocean/10 text-ocean dark:text-sky">
                <Upload className="size-6" />
              </span>
            )}
            <span className="text-sm font-medium">
              {logoMutation.isPending ? "Envoi en cours…" : company?.logoUrl ? "Changer le logo" : "Glissez-déposez ou cliquez"}
            </span>
            <span className="text-xs text-muted-foreground">PNG ou JPG · 5 Mo max</span>
            <input
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={onLogoChange}
              disabled={logoMutation.isPending}
            />
          </label>
        </div>
      </div>
    </AdminLayout>
  );
}
