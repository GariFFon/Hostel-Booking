"use client";
import * as React from "react";
import Link from "next/link";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { RatingBadge } from "@/components/common/rating";
import { money } from "@/lib/format";

export interface MapMarker { id: string; slug: string; name: string; lat: number; lng: number; pricePaise: number | null; rating: number; reviews: number; cover?: string | null; city?: string }

const iconCache = new Map<string, L.DivIcon>();
function pinIcon(label: string, active: boolean) {
  const key = `${label}|${active}`;
  let i = iconCache.get(key);
  if (!i) {
    // `label` is built from a number in money(): no user text ever reaches this HTML string.
    i = L.divIcon({ className: "", html: `<div class="map-pin" data-active="${active}">${label}</div>`, iconSize: [64, 30], iconAnchor: [32, 15], popupAnchor: [0, -18] });
    iconCache.set(key, i);
  }
  return i;
}

function FitToMarkers({ markers, fitKey }: { markers: MapMarker[]; fitKey: string }) {
  const map = useMap();
  const done = React.useRef<string>("");
  React.useEffect(() => {
    if (done.current === fitKey || markers.length === 0) return;
    done.current = fitKey;
    const b = L.latLngBounds(markers.map((m) => [m.lat, m.lng] as [number, number]));
    map.fitBounds(b, { padding: [48, 48], maxZoom: 14, animate: false });
  }, [markers, fitKey, map]);
  return null;
}

function BoundsWatcher({ onMoved }: { onMoved?: (bbox: string) => void }) {
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const map = useMapEvents({
    moveend: () => {
      if (!onMoved) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => { const b = map.getBounds(); onMoved([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(5)).join(",")); }, 450);
    },
  });
  return null;
}

export default function HostelMapInner({ markers, highlightId, fitKey, onMoved, interactive = true, zoom = 12, className }: {
  markers: MapMarker[]; highlightId?: string | null; fitKey?: string; onMoved?: (bbox: string) => void; interactive?: boolean; zoom?: number; className?: string;
}) {
  const first = markers[0];
  return (
    <MapContainer
      center={first ? [first.lat, first.lng] : [20.59, 78.96]} zoom={first ? zoom : 5} minZoom={3} className={className ?? "size-full"}
      scrollWheelZoom={interactive} dragging={interactive} touchZoom={interactive} doubleClickZoom={interactive} keyboard={interactive} zoomControl={interactive} attributionControl
      aria-label="Map of stays"
    >
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} />
      {fitKey && <FitToMarkers markers={markers} fitKey={fitKey} />}
      <BoundsWatcher onMoved={onMoved} />
      {markers.map((m) => (
        <Marker key={m.id} position={[m.lat, m.lng]} icon={pinIcon(m.pricePaise === null ? "—" : money(m.pricePaise), highlightId === m.id)} zIndexOffset={highlightId === m.id ? 1000 : 0} title={m.name} keyboard>
          {interactive && (
            <Popup closeButton autoPan>
              <Link href={`/hostels/${m.slug}`} className="block outline-none">
                <div className="aspect-[16/9] bg-muted">{ }{m.cover && <img src={m.cover} alt="" className="size-full object-cover" loading="lazy" />}</div>
                <div className="grid gap-0.5 p-3">
                  <span className="line-clamp-1 text-sm font-semibold">{m.name}</span>
                  <span className="flex items-center justify-between gap-2 text-sm"><RatingBadge rating={m.rating} count={m.reviews} /><span className="tnum font-semibold">{money(m.pricePaise)}</span></span>
                </div>
              </Link>
            </Popup>
          )}
        </Marker>
      ))}
    </MapContainer>
  );
}
