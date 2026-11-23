import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CloudOff, Loader2, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDate } from "@/lib/mock-data";
import { ApiError, acknowledgeSyncConflict, getSyncStatus, listSyncConflicts } from "@/lib/api";

/**
 * Always visible: online/offline/syncing reflects this instance's connectivity from day one, even
 * before any cloud deployment exists to actually sync business data against (see
 * ConnectivityMonitor on the backend). `cloudConfigured` only changes the copy shown, never
 * whether the badge itself appears.
 */
export function SyncStatusBadge() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data: status } = useQuery({
    queryKey: ["sync-status"],
    queryFn: getSyncStatus,
    refetchInterval: 15000,
  });

  const { data: conflicts = [] } = useQuery({
    queryKey: ["sync-conflicts"],
    queryFn: listSyncConflicts,
    enabled: open && (status?.openConflictCount ?? 0) > 0,
  });

  const acknowledgeMutation = useMutation({
    mutationFn: acknowledgeSyncConflict,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sync-conflicts"] });
      queryClient.invalidateQueries({ queryKey: ["sync-status"] });
    },
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : "Échec de la validation";
      toast.error("Échec de la validation", { description: message });
    },
  });

  if (!status) return null;

  const hasConflicts = status.openConflictCount > 0;

  const icon = status.syncing ? (
    <Loader2 className="size-6 animate-spin text-ocean dark:text-sky" />
  ) : status.online ? (
    <CheckCircle2 className="size-6 text-success" />
  ) : (
    <CloudOff className="size-6 text-muted-foreground" />
  );

  const label = status.syncing ? "Synchronisation…" : status.online ? "En ligne" : "Hors ligne";

  const detail = status.syncing
    ? "Envoi des modifications en cours…"
    : status.online
      ? status.cloudConfigured && status.lastSuccessAt
        ? `Dernière synchro : ${formatDate(status.lastSuccessAt)}`
        : "Connexion internet détectée."
      : (status.lastErrorMessage ?? "Pas de connexion — les modifications restent en local et seront envoyées au retour du réseau.");

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative size-11 rounded-xl" title={label}>
          {icon}
          {hasConflicts ? (
            <span className="absolute top-1 right-1 grid size-[18px] place-items-center rounded-full bg-warning text-[11px] font-semibold text-white">
              {status.openConflictCount > 9 ? "9+" : status.openConflictCount}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 rounded-xl">
        <DropdownMenuLabel className="flex items-center gap-2">
          {icon} {label}
        </DropdownMenuLabel>
        <div className="px-2 pb-1.5 text-xs text-muted-foreground">{detail}</div>
        {hasConflicts ? (
          <>
            <DropdownMenuSeparator />
            <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-warning">
              <AlertTriangle className="size-3.5" /> {status.openConflictCount} conflit(s) à vérifier
            </div>
            <div className="max-h-72 overflow-y-auto">
              {conflicts.map((conflict) => (
                <DropdownMenuItem
                  key={conflict.id}
                  className="flex flex-col items-start gap-1 rounded-lg py-2.5"
                  onSelect={(e) => e.preventDefault()}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <p className="text-sm font-medium">{conflict.collectionName}</p>
                    <span className="text-[11px] text-muted-foreground">{formatDate(conflict.created)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Une modification faite hors ligne a remplacé une version plus récente sur le cloud. Vérifiez que rien
                    d'important n'a été perdu.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-1 h-7 rounded-lg text-xs"
                    disabled={acknowledgeMutation.isPending}
                    onClick={() => acknowledgeMutation.mutate(conflict.id)}
                  >
                    <RefreshCcw className="mr-1 size-3" /> Marquer comme vérifié
                  </Button>
                </DropdownMenuItem>
              ))}
            </div>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
