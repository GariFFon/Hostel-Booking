"use client";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

/** Leaflet touches `window`, so it is loaded in the browser only (and code-split away from pages that never show a map). */
export const HostelMap = dynamic(() => import("./hostel-map-inner"), { ssr: false, loading: () => <Skeleton className="size-full rounded-none" /> });
export type { MapMarker } from "./hostel-map-inner";
