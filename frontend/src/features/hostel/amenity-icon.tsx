import { Armchair, BatteryCharging, Briefcase, Camera, CarFront, Coffee, CookingPot, Dumbbell, Flower2, Laptop, Lock, Plane, ShieldCheck, ShowerHead, Shirt, Snowflake, Sparkles, Sun, Utensils, Wifi, type LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  WIFI: Wifi, AC: Snowflake, LOCKERS: Lock, LAUNDRY: Shirt, BREAKFAST: Coffee, KITCHEN: CookingPot, CAFE: Coffee, COWORK: Laptop, CCTV: Camera, FEMALE_FLOOR: ShieldCheck,
  HOT_WATER: ShowerHead, POWER_BACKUP: BatteryCharging, COMMON_ROOM: Armchair, ROOFTOP: Sun, YOGA: Flower2, AIRPORT_PICKUP: Plane, PARKING: CarFront, MESS: Utensils, GYM: Dumbbell, WORKSPACE: Briefcase,
};
export function AmenityIcon({ code, className }: { code: string; className?: string }) {
  const Icon = ICONS[code] ?? Sparkles;
  return <Icon className={className} aria-hidden />;
}
