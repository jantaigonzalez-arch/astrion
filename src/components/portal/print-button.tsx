"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton({ label = "Imprimir" }: { label?: string }) {
  return (
    <Button onClick={() => window.print()} variant="accent" className="no-print">
      <Printer className="size-4" /> {label}
    </Button>
  );
}
