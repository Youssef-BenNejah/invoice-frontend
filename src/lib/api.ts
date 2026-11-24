// Thin client for the real Invoxa backend (new/back). Handles the JWT access token
// (kept in memory + sessionStorage so a page refresh doesn't force a re-login) and the
// { success, message, data } envelope every endpoint returns.

import { useSyncExternalStore } from "react";

// VS Code devtunnels (and similar port-forwarding dev proxies) mint a new random tunnel id every
// session — e.g. https://r87l169p-8081.uks1.devtunnels.ms for the frontend on port 8081. Rather
// than hand-editing VITE_API_URL to match every time, detect that pattern from the page's own
// origin and swap the port segment to the backend's (8090), so it always finds the backend
// forwarded under the same tunnel session without any .env change.
function resolveApiUrl(): string {
	const fallback = import.meta.env["VITE_API_URL"] ?? "http://localhost:8090/api/v1";
	if (typeof window === "undefined") return fallback;
	const host = window.location.hostname;
	const match = host.match(/^(.+)-\d+\.([a-z0-9]+\.devtunnels\.ms)$/i);
	if (!match) return fallback;
	const [, tunnelId, suffix] = match;
	return `${window.location.protocol}//${tunnelId}-8090.${suffix}/api/v1`;
}

const API_URL = resolveApiUrl();
const TOKEN_STORAGE_KEY = "invoxa-access-token";
const REMEMBER_KEY = "invoxa-remember";

type ApiEnvelope<T> = {
  success: boolean;
  message: string;
  data: T;
};

// Thrown exceptions (validation, plan limits, not-found, …) are serialized by the backend's
// GlobalExceptionHandler as an RFC7807 ProblemDetail, not the {success,message,data} envelope —
// its human-readable text lives in `detail`, not `message`.
type ApiProblemDetail = { detail?: string; title?: string };

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** True when the server rejected the request because it would exceed a plan limit/feature gate. */
export function isPlanLimitError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 402;
}

function extractErrorMessage(body: unknown, status: number): string {
  const envelope = body as (ApiEnvelope<unknown> & ApiProblemDetail) | null;
  return envelope?.message ?? envelope?.detail ?? `Request failed (${status})`;
}

// "Remember me" decides where the access token lives: localStorage survives browser restarts,
// sessionStorage is wiped when the tab/browser closes. The refresh cookie mirrors this same
// choice server-side (see AuthController#setRefreshCookie), so the two stay consistent.
function rememberPreference(): boolean {
  try {
    return localStorage.getItem(REMEMBER_KEY) === "1";
  } catch {
    return false;
  }
}

function setRememberPreference(remember: boolean) {
  try {
    if (remember) localStorage.setItem(REMEMBER_KEY, "1");
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {
    // ignore — falls back to sessionStorage-only behavior for this tab
  }
}

let accessToken: string | null = readStoredToken();

function readStoredToken(): string | null {
  try {
    return rememberPreference() ? localStorage.getItem(TOKEN_STORAGE_KEY) : sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token: string | null) {
  accessToken = token;
  try {
    const store = rememberPreference() ? localStorage : sessionStorage;
    const other = rememberPreference() ? sessionStorage : localStorage;
    if (token) store.setItem(TOKEN_STORAGE_KEY, token);
    else store.removeItem(TOKEN_STORAGE_KEY);
    other.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // sessionStorage unavailable (SSR, privacy mode) — in-memory token still works for this tab session.
  }
}

async function request<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  // Access token expired mid-session — try the refresh-token cookie once, then retry the call.
  if (res.status === 401 && retry && path !== "/auth/refresh" && path !== "/auth/login") {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, options, false);
  }

  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok || !body?.success) {
    throw new ApiError(extractErrorMessage(body, res.status), res.status);
  }
  return body.data;
}

// For binary endpoints (PDF/ZIP downloads) — the generic `request` above always parses JSON.
async function requestBlob(path: string, retry = true): Promise<{ blob: Blob; fileName: string | null }> {
  const headers = new Headers();
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  const res = await fetch(`${API_URL}${path}`, { headers, credentials: "include" });

  if (res.status === 401 && retry) {
    const refreshed = await tryRefresh();
    if (refreshed) return requestBlob(path, false);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(extractErrorMessage(body, res.status), res.status);
  }
  const disposition = res.headers.get("Content-Disposition");
  const match = disposition?.match(/filename="?([^"]+)"?/);
  return { blob: await res.blob(), fileName: match?.[1] ?? null };
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function uploadFile<T>(path: string, file: File, fieldName = "file", retry = true): Promise<T> {
  const formData = new FormData();
  formData.append(fieldName, file);

  const headers = new Headers();
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  // No Content-Type here — the browser sets multipart/form-data with the correct boundary.

  const res = await fetch(`${API_URL}${path}`, { method: "POST", headers, body: formData, credentials: "include" });

  if (res.status === 401 && retry) {
    const refreshed = await tryRefresh();
    if (refreshed) return uploadFile<T>(path, file, fieldName, false);
  }

  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok || !body?.success) {
    throw new ApiError(extractErrorMessage(body, res.status), res.status);
  }
  return body.data;
}

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, { method: "POST", credentials: "include" });
    if (!res.ok) return false;
    const body = (await res.json()) as ApiEnvelope<{ accessToken: string }>;
    if (!body.success) return false;
    setAccessToken(body.data.accessToken);
    return true;
  } catch {
    return false;
  }
}

// ---------- Auth ----------

export type ApiRole = "USER" | "ADMIN";
export type ApiAccountStatus = "ACTIVE" | "SUSPENDED" | "DISABLED" | "EXPIRED";

export type ApiUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
  role: ApiRole;
  status: ApiAccountStatus;
  planExpiresAt: string | null;
  planId: string | null;
  renewalRequested: boolean;
  createdAt: string;
};

let currentUser: ApiUser | null = null;
const currentUserListeners = new Set<() => void>();
export function setCurrentUser(user: ApiUser | null) {
  currentUser = user;
  currentUserListeners.forEach((l) => l());
}
/** Synchronous snapshot of the current user, for use outside React (e.g. route `beforeLoad`). */
export function getCurrentUser() {
  return currentUser;
}
export function useCurrentUser() {
  return useSyncExternalStore(
    (cb) => {
      currentUserListeners.add(cb);
      return () => currentUserListeners.delete(cb);
    },
    () => currentUser,
    () => currentUser,
  );
}

// A page refresh keeps the access token (sessionStorage) but loses the in-memory user/role —
// re-fetch it once so role-gated UI (e.g. the Super Admin nav) doesn't flash open before we know.
if (typeof window !== "undefined" && accessToken) {
  fetchMe()
    .then(setCurrentUser)
    .catch(() => setAccessToken(null));
}

export async function login(email: string, password: string, rememberMe = false) {
  const data = await request<{ accessToken: string; user: ApiUser }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password, rememberMe }),
  });
  setRememberPreference(rememberMe);
  setAccessToken(data.accessToken);
  setCurrentUser(data.user);
  return data.user;
}

export async function logout() {
  try {
    await request<void>("/auth/logout", { method: "POST" });
  } finally {
    setAccessToken(null);
    setCurrentUser(null);
    setRememberPreference(false);
  }
}

export function fetchMe() {
  return request<ApiUser>("/auth/me");
}

// Re-fetches /auth/me and syncs the reactive useCurrentUser() store — call after a
// self-service mutation (e.g. requesting a renewal) that changes the current user's own record.
export async function refreshCurrentUser() {
  const user = await fetchMe();
  setCurrentUser(user);
  return user;
}

export async function updateMyProfile(payload: { firstName: string; lastName: string }) {
  const user = await request<ApiUser>("/auth/me", { method: "PUT", body: JSON.stringify(payload) });
  setCurrentUser(user);
  return user;
}

export async function uploadMyPhoto(file: File) {
  const user = await uploadFile<ApiUser>("/auth/me/photo", file);
  setCurrentUser(user);
  return user;
}

export function forgotPassword(email: string) {
  return request<void>("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
}

export function verifyResetCode(email: string, code: string) {
  return request<{ resetToken: string }>("/auth/verify-reset-code", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
}

export function resetPassword(resetToken: string, newPassword: string) {
  return request<void>("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ resetToken, newPassword }),
  });
}

export type AdminCreateUserPayload = {
  email: string;
  firstName: string;
  lastName: string;
  status?: ApiAccountStatus;
  planExpiresAt?: string;
  planId?: string;
};

export function adminCreateUser(payload: AdminCreateUserPayload) {
  return request<ApiUser>("/auth/admin/users", { method: "POST", body: JSON.stringify(payload) });
}

export function adminListUsers() {
  return request<ApiUser[]>("/auth/admin/users");
}

export type AdminUpdateUserPayload = {
  firstName: string;
  lastName: string;
  status?: ApiAccountStatus;
  planExpiresAt?: string;
  planId?: string;
};

export function adminUpdateUser(id: string, payload: AdminUpdateUserPayload) {
  return request<ApiUser>(`/auth/admin/users/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}

export function adminDeleteUser(id: string) {
  return request<void>(`/auth/admin/users/${id}`, { method: "DELETE" });
}

export function adminApproveRenewal(id: string) {
  return request<ApiUser>(`/auth/admin/users/${id}/approve-renewal`, { method: "POST" });
}

export function adminRejectRenewal(id: string) {
  return request<ApiUser>(`/auth/admin/users/${id}/reject-renewal`, { method: "POST" });
}

export function requestRenewal() {
  return request<void>("/auth/request-renewal", { method: "POST" });
}

// ---------- Join requests ----------

export type ApiJoinRequestStatus = "PENDING" | "CONTACTED" | "CONVERTED" | "REJECTED";

export type ApiJoinRequest = {
  id: string;
  nom: string;
  prenom: string;
  email: string;
  telephone: string;
  entreprise: string;
  message: string | null;
  requestedPlanId: string | null;
  requestedPlanNom: string | null;
  status: ApiJoinRequestStatus;
  createdAt: string;
};

export type SubmitJoinRequestPayload = {
  nom: string;
  prenom: string;
  email: string;
  telephone: string;
  entreprise: string;
  message?: string;
  requestedPlanId?: string;
};

export function submitJoinRequest(payload: SubmitJoinRequestPayload) {
  return request<ApiJoinRequest>("/join-requests", { method: "POST", body: JSON.stringify(payload) });
}

export function listJoinRequests() {
  return request<ApiJoinRequest[]>("/join-requests");
}

export function contactJoinRequest(id: string) {
  return request<ApiJoinRequest>(`/join-requests/${id}/contact`, { method: "PATCH" });
}

export function rejectJoinRequest(id: string) {
  return request<ApiJoinRequest>(`/join-requests/${id}/reject`, { method: "PATCH" });
}

export function convertJoinRequest(id: string, trialDays?: number, planId?: string) {
  return request<ApiUser>(`/join-requests/${id}/convert`, {
    method: "POST",
    body: JSON.stringify({ trialDays, planId }),
  });
}

// ---------- Personnes ----------

export type ApiPerson = {
  id: string;
  prenom: string;
  nom: string;
  email: string;
  telephone: string;
  pays: string;
  cin: string | null;
  adresse: string;
  isClient: boolean;
  entreprise: { id: string; nom: string } | null;
  createdBy: string;
  created: string;
};

export type PersonPayload = {
  prenom: string;
  nom: string;
  email: string;
  telephone: string;
  pays: string;
  cin?: string;
  adresse: string;
  entrepriseId?: string;
};

export function listPersons() {
  return request<ApiPerson[]>("/persons");
}

export function createPerson(payload: PersonPayload) {
  return request<ApiPerson>("/persons", { method: "POST", body: JSON.stringify(payload) });
}

export function updatePerson(id: string, payload: PersonPayload) {
  return request<ApiPerson>(`/persons/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}

export function deletePerson(id: string) {
  return request<void>(`/persons/${id}`, { method: "DELETE" });
}


// ---------- Entreprises ----------

export type ApiEntreprise = {
  id: string;
  nom: string;
  email: string;
  telephone: string;
  pays: string;
  siteweb: string | null;
  rib: string | null;
  fisc: string;
  adresse: string;
  isClient: boolean;
  mainContact: { id: string; prenom: string; nom: string } | null;
  createdBy: string;
  created: string;
};

export type EntreprisePayload = {
  nom: string;
  email: string;
  telephone: string;
  pays: string;
  siteweb?: string;
  rib?: string;
  fisc: string;
  adresse: string;
  mainContactId?: string;
};

export function listEntreprises() {
  return request<ApiEntreprise[]>("/entreprises");
}

export function createEntreprise(payload: EntreprisePayload) {
  return request<ApiEntreprise>("/entreprises", { method: "POST", body: JSON.stringify(payload) });
}

export function updateEntreprise(id: string, payload: EntreprisePayload) {
  return request<ApiEntreprise>(`/entreprises/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}

export function deleteEntreprise(id: string) {
  return request<void>(`/entreprises/${id}`, { method: "DELETE" });
}


// ---------- Clients ----------

export type ApiClientType = "PERSON" | "COMPANY";

export type ApiClient = {
  id: string;
  type: ApiClientType;
  person: { id: string; prenom: string; nom: string; email: string; telephone: string; cin: string | null; adresse: string } | null;
  entreprise: { id: string; nom: string; email: string; telephone: string; fisc: string; adresse: string } | null;
  createdBy: string;
  created: string;
};

export function createClient(input: { type: ApiClientType; personId?: string; entrepriseId?: string }) {
  return request<ApiClient>("/clients", { method: "POST", body: JSON.stringify(input) });
}

export function listClients() {
  return request<ApiClient[]>("/clients");
}

export function getClientById(id: string) {
  return request<ApiClient>(`/clients/${id}`);
}

export function deleteClient(id: string) {
  return request<void>(`/clients/${id}`, { method: "DELETE" });
}

// ---------- Taxes ----------

export type ApiTax = {
  id: string;
  name: string;
  taxvalue: number;
  isActive: boolean;
  isDefault: boolean;
  createdBy: string;
};

export type TaxPayload = {
  name: string;
  taxvalue: number;
  isActive: boolean;
  isDefault: boolean;
};

export function listTaxes() {
  return request<ApiTax[]>("/taxes");
}

export function createTax(payload: TaxPayload) {
  return request<ApiTax>("/taxes", { method: "POST", body: JSON.stringify(payload) });
}

export function updateTax(id: string, payload: TaxPayload) {
  return request<ApiTax>(`/taxes/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}

export function deleteTax(id: string) {
  return request<void>(`/taxes/${id}`, { method: "DELETE" });
}

export function getTaxById(id: string) {
  return request<ApiTax>(`/taxes/${id}`);
}

export function setDefaultTax(id: string) {
  return request<ApiTax>(`/taxes/${id}/set-default`, { method: "POST" });
}

// ---------- Articles ----------

export type ApiService = {
  id: string;
  name: string;
  currency: string;
  price: number;
  description: string | null;
  reference: string | null;
  defaultTaxId: string | null;
  longueur: number;
  largeur: number;
  hauteur: number;
  prixAchat: number;
  margeGain: number;
  createdBy: string;
  created: string;
  stockQuantity: number;
  averageCost: number;
  stockValue: number;
};

export type ServicePayload = {
  name: string;
  currency: string;
  price: number;
  description?: string;
  reference?: string;
  defaultTaxId?: string;
  longueur?: number;
  largeur?: number;
  hauteur?: number;
  margeGain?: number;
};

export function listServices() {
  return request<ApiService[]>("/services");
}

export function createService(payload: ServicePayload) {
  return request<ApiService>("/services", { method: "POST", body: JSON.stringify(payload) });
}

export function updateService(id: string, payload: ServicePayload) {
  return request<ApiService>(`/services/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}

export function deleteService(id: string) {
  return request<void>(`/services/${id}`, { method: "DELETE" });
}

export function getServiceById(id: string) {
  return request<ApiService>(`/services/${id}`);
}

// ---------- Stock (read-only ledger, driven by factures d'achat/vente) ----------

export type ApiStockDashboardItem = {
  productId: string;
  article: string;
  ref: string | null;
  quantite: number;
  puHT: number;
  totalHT: number;
  puTTC: number;
  totalTTC: number;
};

export type ApiStockDashboard = {
  totalValueHT: number;
  totalValueTTC: number;
  items: ApiStockDashboardItem[];
};

export function getStockDashboard() {
  return request<ApiStockDashboard>("/stock/dashboard");
}

export type ApiStockVenteDashboardItem = {
  productId: string;
  article: string;
  ref: string | null;
  quantite: number;
  puHTVente: number;
  totalHTVente: number;
  puTTCVente: number;
  totalTTCVente: number;
};

export type ApiStockVenteDashboard = {
  totalValueHTVente: number;
  totalValueTTCVente: number;
  items: ApiStockVenteDashboardItem[];
};

export function getStockVenteDashboard() {
  return request<ApiStockVenteDashboard>("/stock/dashboard/vente");
}

export async function downloadStockReportPdf() {
  const { blob, fileName } = await requestBlob("/stock/dashboard/pdf");
  triggerBlobDownload(blob, fileName ?? "rapport-stock.pdf");
}

export type ApiStockReportItem = {
  productId: string;
  article: string;
  ref: string | null;
  quantite: number;
  puHT: number;
  totalHT: number;
  puTTC: number;
  totalTTC: number;
};

export type ApiStockReport = {
  year: number;
  month: number;
  totalHT: number;
  totalTVA: number;
  totalTTC: number;
  items: ApiStockReportItem[];
};

export function getStockReport(year: number, month: number) {
  const params = new URLSearchParams({ year: String(year), month: String(month) });
  return request<ApiStockReport>(`/stock/report?${params.toString()}`);
}

export async function downloadStockReportMonthlyPdf(year: number, month: number) {
  const params = new URLSearchParams({ year: String(year), month: String(month) });
  const { blob, fileName } = await requestBlob(`/stock/report/pdf?${params.toString()}`);
  triggerBlobDownload(blob, fileName ?? `rapport-stock-${year}-${month}.pdf`);
}

export type ApiStockMovementType = "ACHAT" | "VENTE" | "AJUSTEMENT" | "ANNULATION_ACHAT" | "ANNULATION_VENTE";

export type ApiStockMovement = {
  id: string;
  productId: string;
  article: string | null;
  ref: string | null;
  type: ApiStockMovementType;
  quantityDelta: number;
  unitCost: number;
  quantityBefore: number;
  averageCostBefore: number;
  quantityAfter: number;
  averageCostAfter: number;
  sourceType: string;
  sourceId: string | null;
  reason: string | null;
  createdBy: string;
  created: string;
};

export function listStockMovements() {
  return request<ApiStockMovement[]>("/stock/movements");
}

// ---------- Devises ----------

export type ApiCurrency = {
  id: string;
  code: string;
  name: string;
  symbol: string;
  createdBy: string;
};

export type CurrencyPayload = {
  code: string;
  name: string;
  symbol: string;
};

export function listCurrencies() {
  return request<ApiCurrency[]>("/currencies");
}

export function createCurrency(payload: CurrencyPayload) {
  return request<ApiCurrency>("/currencies", { method: "POST", body: JSON.stringify(payload) });
}

export function updateCurrency(id: string, payload: CurrencyPayload) {
  return request<ApiCurrency>(`/currencies/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}

export function deleteCurrency(id: string) {
  return request<void>(`/currencies/${id}`, { method: "DELETE" });
}

// ---------- Notes impayés fournisseurs ----------

export type ApiNoteStatus = "NON_PAYE" | "PAYE";

export type ApiDepenseNote = {
  id: string;
  fournisseurNom: string | null;
  telephone: string | null;
  montant: number;
  date: string | null;
  status: ApiNoteStatus;
  description: string | null;
  createdBy: string;
  created: string;
};

export type DepenseNotePayload = {
  fournisseurNom?: string;
  telephone?: string;
  montant?: number;
  date?: string;
  status?: ApiNoteStatus;
  description?: string;
};

export function listDepenseNotes() {
  return request<ApiDepenseNote[]>("/depense-notes");
}

export function createDepenseNote(payload: DepenseNotePayload) {
  return request<ApiDepenseNote>("/depense-notes", { method: "POST", body: JSON.stringify(payload) });
}

export function updateDepenseNote(id: string, payload: DepenseNotePayload) {
  return request<ApiDepenseNote>(`/depense-notes/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}

export function updateDepenseNoteStatus(id: string, status: ApiNoteStatus) {
  return request<ApiDepenseNote>(`/depense-notes/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
}

export function deleteDepenseNote(id: string) {
  return request<void>(`/depense-notes/${id}`, { method: "DELETE" });
}

// ---------- Ma entreprise ----------

export type ApiCompany = {
  id: string;
  name: string;
  matriculeFisc: string | null;
  address: string | null;
  state: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  taxNumber: string | null;
  vatNumber: string | null;
  registrationNumber: string | null;
  logoUrl: string | null;
};

export type CompanyPayload = {
  name: string;
  matriculeFisc?: string;
  address?: string;
  state?: string;
  country?: string;
  email?: string;
  phone?: string;
  website?: string;
  taxNumber?: string;
  vatNumber?: string;
  registrationNumber?: string;
};

export function getMyCompany() {
  return request<ApiCompany>("/company/me");
}

export function updateMyCompany(payload: CompanyPayload) {
  return request<ApiCompany>("/company/me", { method: "PUT", body: JSON.stringify(payload) });
}

export function uploadCompanyLogo(file: File) {
  return uploadFile<ApiCompany>("/company/me/logo", file);
}

// ---------- Fournisseurs ----------

export type ApiFournisseur = {
  id: string;
  nom: string;
  email: string | null;
  telephone: string | null;
  fisc: string | null;
  adresse: string | null;
  createdBy: string;
  created: string;
};

export type FournisseurPayload = {
  nom: string;
  email?: string;
  telephone?: string;
  fisc?: string;
  adresse?: string;
};

export function listFournisseurs() {
  return request<ApiFournisseur[]>("/fournisseurs");
}

export function getFournisseurById(id: string) {
  return request<ApiFournisseur>(`/fournisseurs/${id}`);
}

export function createFournisseur(payload: FournisseurPayload) {
  return request<ApiFournisseur>("/fournisseurs", { method: "POST", body: JSON.stringify(payload) });
}

export function updateFournisseur(id: string, payload: FournisseurPayload) {
  return request<ApiFournisseur>(`/fournisseurs/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}

export function deleteFournisseur(id: string) {
  return request<void>(`/fournisseurs/${id}`, { method: "DELETE" });
}

// ---------- Factures ----------

export type ApiInvoiceStatus = "Facture" | "Devis" | "Bon de livraison";
export type ApiPaymentStatus = "impayé" | "Partiellement payé" | "Payé";
export type ApiInvoiceType = "Standard" | "Proforma" | "Achat";

export type ApiInvoiceItem = {
  id: string;
  productId: string | null;
  ref: string | null;
  article: string;
  description: string | null;
  quantity: number;
  price: number;
  taxId: string | null;
  taxRate: number;
  taxAmount: number;
  taxName: string | null;
  total: number;
};

export type ApiInvoice = {
  id: string;
  client: ApiClient | null;
  fournisseur: ApiFournisseur | null;
  number: number;
  year: number;
  currency: ApiCurrency;
  status: ApiInvoiceStatus;
  paymentStatus: ApiPaymentStatus;
  type: ApiInvoiceType;
  isConverted: boolean;
  date: string;
  items: ApiInvoiceItem[];
  timbre: number;
  subtotal: number;
  taxAmount: number;
  total: number;
  paidAmount: number;
  createdBy: string;
  created: string;
  factureImage: string | null;
};

export type InvoiceItemPayload = {
  productId?: string;
  ref?: string;
  article: string;
  description?: string;
  quantity: number;
  price: number;
  taxId?: string;
};

export type InvoicePayload = {
  clientId?: string;
  fournisseurId?: string;
  currencyId: string;
  status: ApiInvoiceStatus;
  type?: ApiInvoiceType;
  date: string;
  timbre: number;
  items: InvoiceItemPayload[];
  factureImage?: string | null;
};

export function listInvoices() {
  return request<ApiInvoice[]>("/invoices");
}

export function getInvoiceById(id: string) {
  return request<ApiInvoice>(`/invoices/${id}`);
}

export function createInvoice(payload: InvoicePayload) {
  return request<ApiInvoice>("/invoices", { method: "POST", body: JSON.stringify(payload) });
}

export function updateInvoiceApi(id: string, payload: InvoicePayload) {
  return request<ApiInvoice>(`/invoices/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}

export function deleteInvoiceApi(id: string) {
  return request<void>(`/invoices/${id}`, { method: "DELETE" });
}

export function duplicateInvoiceApi(id: string) {
  return request<ApiInvoice>(`/invoices/${id}/duplicate`, { method: "POST" });
}

export function convertInvoiceApi(id: string) {
  return request<ApiInvoice>(`/invoices/${id}/convert`, { method: "POST" });
}

// ---------- Import en masse ----------

export type InvoiceImportRowPayload = {
  line: number;
  client: string;
  date: string;
  devise: string;
  montant: number;
  montantPaye?: number;
  statut?: ApiPaymentStatus;
  type?: ApiInvoiceType;
  numero?: number;
  factureImage?: string;
};

export type InvoiceImportPayload = {
  fromDate: string;
  toDate: string;
  rows: InvoiceImportRowPayload[];
};

export type ApiInvoiceImportRowResult = {
  line: number;
  success: boolean;
  message: string | null;
  invoiceId: string | null;
};

export type ApiInvoiceImportResult = {
  imported: number;
  failed: number;
  results: ApiInvoiceImportRowResult[];
};

export function bulkImportInvoices(payload: InvoiceImportPayload) {
  return request<ApiInvoiceImportResult>("/invoices/import", { method: "POST", body: JSON.stringify(payload) });
}

export function uploadInvoiceDocument(file: File) {
  return uploadFile<{ url: string }>("/invoices/documents", file);
}

// ---------- Paiements ----------

export type ApiPaymentMethod = "Virement bancaire" | "Espèces" | "Autres";

export type ApiPayment = {
  id: string;
  invoice: {
    id: string;
    number: number;
    year: number;
    type: ApiInvoiceType;
    total: number;
    currency: ApiCurrency;
  };
  amountPaid: number;
  paymentMethod: ApiPaymentMethod;
  paymentDate: string;
  createdBy: string;
};

export type PaymentPayload = {
  invoiceId: string;
  amountPaid: number;
  paymentMethod: ApiPaymentMethod;
  paymentDate: string;
};

export function listPaymentsForInvoice(invoiceId: string) {
  return request<ApiPayment[]>(`/invoices/${invoiceId}/payments`);
}

export function recordPaymentApi(payload: PaymentPayload) {
  return request<ApiPayment>("/payments", { method: "POST", body: JSON.stringify(payload) });
}

export function deletePaymentApi(id: string) {
  return request<void>(`/payments/${id}`, { method: "DELETE" });
}

// ---------- Dashboard ----------

export type ApiCurrencyAmount = { currency: string; amount: number };

export type ApiDashboardSummary = {
  revenue: number;
  unpaidInvoicesCount: number;
  clientsCount: number;
  monthlyExpenses: number;
  revenueTrend: number[];
  unpaidTrend: number[];
  clientsTrend: number[];
  expensesTrend: number[];
  revenueByCurrency: ApiCurrencyAmount[];
  expensesByCurrency: ApiCurrencyAmount[];
};

export type ApiRevenueSeriesPoint = { mois: string; revenus: number; depenses: number };
export type ApiDistributionPoint = { name: string; value: number };
export type ApiRecentActivity = { id: string; titre: string; detail: string; temps: string };

export function getDashboardSummary(currency?: string) {
  const qs = currency ? `?currency=${encodeURIComponent(currency)}` : "";
  return request<ApiDashboardSummary>(`/dashboard/summary${qs}`);
}

export function getRevenueSeries(months = 12, currency?: string) {
  const params = new URLSearchParams({ months: String(months) });
  if (currency) params.set("currency", currency);
  return request<ApiRevenueSeriesPoint[]>(`/dashboard/revenue-series?${params.toString()}`);
}

export function getInvoiceStatusDistribution() {
  return request<ApiDistributionPoint[]>("/dashboard/invoice-status-distribution");
}

export function getRecentInvoices(limit = 5) {
  return request<ApiInvoice[]>(`/dashboard/recent-invoices?limit=${limit}`);
}

export function getRecentActivity(limit = 5) {
  return request<ApiRecentActivity[]>(`/dashboard/recent-activity?limit=${limit}`);
}

// ---------- Rapports ----------

export type ApiReportOverview = {
  totalRevenue: number;
  totalExpenses: number;
  revenueByCurrency: ApiCurrencyAmount[];
  expensesByCurrency: ApiCurrencyAmount[];
};
export type ApiTopClient = { clientId: string; nom: string; total: number };
export type ApiTopService = { name: string; totalSold: number };

export function getReportOverview(dateFrom?: string, dateTo?: string, currency?: string) {
  const params = new URLSearchParams();
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  if (currency) params.set("currency", currency);
  const qs = params.toString();
  return request<ApiReportOverview>(`/reports/overview${qs ? `?${qs}` : ""}`);
}

export function getTopClients(limit = 5, currency?: string) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (currency) params.set("currency", currency);
  return request<ApiTopClient[]>(`/reports/top-clients?${params.toString()}`);
}

export function getTopServices(limit = 5, currency?: string) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (currency) params.set("currency", currency);
  return request<ApiTopService[]>(`/reports/top-services?${params.toString()}`);
}

// ---------- Notifications ----------

export type ApiNotificationType = "renewal_request" | "renewal_approved" | "renewal_rejected" | "join_request";

export type ApiNotification = {
  id: string;
  type: ApiNotificationType;
  tenantAdminId: string;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
};

export function listNotifications() {
  return request<ApiNotification[]>("/notifications");
}

export function markNotificationRead(id: string) {
  return request<void>(`/notifications/${id}/read`, { method: "PATCH" });
}

export function markAllNotificationsRead() {
  return request<void>("/notifications/read-all", { method: "PATCH" });
}

// ---------- Plans ----------

export type ApiPlan = {
  id: string;
  nom: string;
  tagline: string;
  prixMensuel: number;
  prixAnnuel: number;
  populaire: boolean;
  fonctionnalites: string[];
  freeTrial: boolean;
  trialDurationDays: number | null;
  maxInvoicesPerMonth: number | null;
  maxClients: number | null;
  maxProducts: number | null;
  maxCustomTaxes: number | null;
  multiCurrency: boolean;
  reportsAccess: boolean;
  expensesEnabled: boolean;
  bulkExportEnabled: boolean;
};

export type PlanPayload = {
  nom: string;
  tagline: string;
  prixMensuel: number;
  prixAnnuel: number;
  populaire: boolean;
  fonctionnalites: string[];
  freeTrial: boolean;
  trialDurationDays?: number | null;
  maxInvoicesPerMonth?: number | null;
  maxClients?: number | null;
  maxProducts?: number | null;
  maxCustomTaxes?: number | null;
  multiCurrency: boolean;
  reportsAccess: boolean;
  expensesEnabled: boolean;
  bulkExportEnabled: boolean;
};

export function listPlans() {
  return request<ApiPlan[]>("/plans");
}

export function createPlanApi(payload: PlanPayload) {
  return request<ApiPlan>("/plans", { method: "POST", body: JSON.stringify(payload) });
}

export function updatePlanApi(id: string, payload: PlanPayload) {
  return request<ApiPlan>(`/plans/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}

export function deletePlanApi(id: string) {
  return request<void>(`/plans/${id}`, { method: "DELETE" });
}

// ---------- Plan usage (current tenant) ----------

export type ApiLimitUsage = { used: number; limit: number | null };

export type ApiPlanUsage = {
  planId: string | null;
  planNom: string | null;
  freeTrial: boolean;
  planExpiresAt: string | null;
  trialDaysLeft: number | null;
  invoices: ApiLimitUsage;
  clients: ApiLimitUsage;
  products: ApiLimitUsage;
  customTaxes: ApiLimitUsage;
  currenciesUsed: number;
  multiCurrency: boolean;
  reportsAccess: boolean;
  expensesEnabled: boolean;
  bulkExportEnabled: boolean;
};

export function getMyPlanUsage() {
  return request<ApiPlanUsage>("/plan-usage/me");
}

// ---------- Admin — reset password ----------

export function adminResetPassword(id: string) {
  return request<void>(`/auth/admin/users/${id}/reset-password`, { method: "POST" });
}

// ---------- Invoice PDF / export (server-rendered) ----------

export async function downloadInvoicePdf(id: string, fallbackName: string) {
  const { blob, fileName } = await requestBlob(`/invoices/${id}/pdf`);
  triggerBlobDownload(blob, fileName ?? fallbackName);
}

export async function downloadInvoicesSummaryPdf(ids: string[], fallbackName: string) {
  const qs = ids.length ? `?${ids.map((i) => `ids=${encodeURIComponent(i)}`).join("&")}` : "";
  const { blob, fileName } = await requestBlob(`/invoices/export/summary${qs}`);
  triggerBlobDownload(blob, fileName ?? fallbackName);
}

export async function downloadInvoicesZip(ids: string[]) {
  const qs = ids.length ? `?${ids.map((i) => `ids=${encodeURIComponent(i)}`).join("&")}` : "";
  const { blob, fileName } = await requestBlob(`/invoices/export/zip${qs}`);
  triggerBlobDownload(blob, fileName ?? "factures.zip");
}

export async function downloadReportPdf(dateFrom?: string, dateTo?: string, currency?: string) {
  const params = new URLSearchParams();
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  if (currency) params.set("currency", currency);
  const qs = params.toString();
  const { blob, fileName } = await requestBlob(`/reports/export${qs ? `?${qs}` : ""}`);
  triggerBlobDownload(blob, fileName ?? "rapport.pdf");
}

// ---------- Paiements (global ledger) ----------

export function listAllPayments() {
  return request<ApiPayment[]>("/payments");
}

// ---------- Sync (desktop offline/online + cloud conflicts) ----------

export type ApiSyncStatus = {
  cloudConfigured: boolean;
  online: boolean;
  syncing: boolean;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastErrorMessage: string | null;
  openConflictCount: number;
};

export type ApiSyncConflict = {
  id: string;
  collectionName: string;
  documentId: string;
  previousCloudPayload: Record<string, unknown> | null;
  incomingPayload: Record<string, unknown> | null;
  created: string;
};

export function getSyncStatus() {
  return request<ApiSyncStatus>("/sync/status");
}

export function listSyncConflicts() {
  return request<ApiSyncConflict[]>("/sync/conflicts");
}

export function acknowledgeSyncConflict(id: string) {
  return request<void>(`/sync/conflicts/${id}/acknowledge`, { method: "POST" });
}
