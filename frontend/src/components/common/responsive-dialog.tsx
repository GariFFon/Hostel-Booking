"use client";
import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { useIsDesktop } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

/** A centred dialog on desktop, a draggable bottom sheet on phones: one API, native feel on both. */
export function ResponsiveDialog({ open, onOpenChange, title, description, children, className, dismissible = true }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; className?: string; dismissible?: boolean;
}) {
  const desktop = useIsDesktop();
  const guard = (o: boolean) => { if (dismissible || o) onOpenChange(o); };
  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={guard}>
        <DialogContent className={className} showClose={dismissible} onInteractOutside={(e) => { if (!dismissible) e.preventDefault(); }} onEscapeKeyDown={(e) => { if (!dismissible) e.preventDefault(); }}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">{typeof title === "string" ? title : "Dialog"}</DialogDescription>}
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Drawer open={open} onOpenChange={guard} dismissible={dismissible}>
      <DrawerContent className={cn(className)}>
        <div className="flex flex-col gap-1.5">
          <DrawerTitle>{title}</DrawerTitle>
          {description ? <DrawerDescription>{description}</DrawerDescription> : <DrawerDescription className="sr-only">{typeof title === "string" ? title : "Dialog"}</DrawerDescription>}
        </div>
        {children}
      </DrawerContent>
    </Drawer>
  );
}
