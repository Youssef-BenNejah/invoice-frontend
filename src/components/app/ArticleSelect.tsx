import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ApiService } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Searchable article picker — a Select would force scanning the whole catalog to find one product. */
export function ArticleSelect({
  value,
  services,
  onSelect,
  placeholder = "Lier un produit du stock…",
  disabled,
}: {
  value: string;
  services: ApiService[];
  onSelect: (service: ApiService) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = services.find((s) => s.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className="h-9 w-full justify-between rounded-lg text-sm font-normal"
        >
          <span className="truncate">
            {selected ? selected.name : <span className="text-muted-foreground">{placeholder}</span>}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Rechercher un article…" />
          <CommandList>
            <CommandEmpty>Aucun article trouvé.</CommandEmpty>
            {services.map((s) => (
              <CommandItem
                key={s.id}
                value={`${s.name} ${s.reference ?? ""}`}
                onSelect={() => {
                  onSelect(s);
                  setOpen(false);
                }}
              >
                <span className="truncate">{s.name}</span>
                {s.stockQuantity > 0 || s.averageCost > 0 ? (
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">stock: {s.stockQuantity}</span>
                ) : null}
                <Check className={cn("ml-1 size-4 shrink-0", value === s.id ? "opacity-100" : "opacity-0")} />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
