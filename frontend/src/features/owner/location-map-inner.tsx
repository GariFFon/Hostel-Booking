"use client";
import * as React from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";

const pin = L.divIcon({ className: "", html: `<div class="map-pin" data-active="true">Here</div>`, iconSize: [64, 30], iconAnchor: [32, 15] });

function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  const last = React.useRef("");
  React.useEffect(() => {
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (key === last.current) return; // the user dragged it here: don't fight them
    last.current = key;
    if (!map.getBounds().contains([lat, lng])) map.setView([lat, lng], Math.max(map.getZoom(), 15), { animate: true });
  }, [lat, lng, map]);
  return null;
}
function Clicks({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

/** Click the map or drag the pin to set the exact location. */
export default function LocationMapInner({ lat, lng, onPick }: { lat?: number; lng?: number; onPick: (lat: number, lng: number) => void }) {
  const has = typeof lat === "number" && typeof lng === "number";
  return (
    <MapContainer center={has ? [lat, lng] : [20.59, 78.96]} zoom={has ? 16 : 5} minZoom={3} className="size-full" scrollWheelZoom>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} />
      <Clicks onPick={onPick} />
      {has && <><Recenter lat={lat} lng={lng} />
        <Marker position={[lat, lng]} icon={pin} draggable eventHandlers={{ dragend: (e) => { const p = (e.target as L.Marker).getLatLng(); onPick(p.lat, p.lng); } }} /></>}
    </MapContainer>
  );
}
