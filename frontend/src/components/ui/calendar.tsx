"use client";
import * as React from "react";
import { DayPicker, type DayPickerProps } from "react-day-picker";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** react-day-picker v9 skinned with our tokens. 44px day cells on touch so dates are easy to hit. */
export function Calendar({ className, classNames, showOutsideDays = false, ...props }: DayPickerProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-1", className)}
      classNames={{
        months: "relative flex flex-col gap-6 sm:flex-row",
        month: "grid w-full gap-3",
        month_caption: "flex h-10 items-center justify-center px-10 text-sm font-semibold",
        nav: "absolute inset-x-0 top-0 flex h-10 items-center justify-between",
        button_previous: "pressable flex size-10 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30",
        button_next: "pressable flex size-10 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "flex-1 pb-1 text-center text-xs font-normal text-muted-foreground",
        week: "mt-1 flex w-full",
        day: "relative flex-1 p-0 text-center text-sm",
        day_button: "pressable tnum mx-auto flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring md:size-9 hover:bg-muted",
        today: "font-semibold text-primary",
        selected: "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button:hover]:bg-primary",
        range_start: "rounded-l-full bg-accent [&>button]:bg-primary [&>button]:text-primary-foreground",
        range_end: "rounded-r-full bg-accent [&>button]:bg-primary [&>button]:text-primary-foreground",
        range_middle: "bg-accent text-accent-foreground [&>button]:rounded-none [&>button]:bg-transparent [&>button:hover]:bg-accent",
        disabled: "text-muted-foreground/40 [&>button]:pointer-events-none line-through",
        outside: "text-muted-foreground/40",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) => (orientation === "left" ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />),
      }}
      {...props}
    />
  );
}
