import type { ApiInvoice } from "./api";

export const apiClientLabel = (c: ApiInvoice["client"]) =>
  !c ? "" : c.type === "PERSON" ? `${c.person?.prenom ?? ""} ${c.person?.nom ?? ""}`.trim() : (c.entreprise?.nom ?? "");

/** Client name for a sale, fournisseur name for an achat — whichever this invoice actually has. */
export const apiPartyLabel = (inv: Pick<ApiInvoice, "client" | "fournisseur">) =>
  inv.fournisseur ? inv.fournisseur.nom : apiClientLabel(inv.client);

export const apiInvoiceNumberLabel = (inv: Pick<ApiInvoice, "type" | "year" | "number">) =>
  `${inv.type === "Proforma" ? "PRO-" : inv.type === "Achat" ? "ACH-" : ""}${inv.number}/${inv.year}`;
