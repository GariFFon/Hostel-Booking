"use client";
import { Banknote, BarChart3, Building2, CalendarCheck, CalendarDays, LayoutDashboard, MessageSquare, ShieldCheck, Tag, Users, Wrench, HardHat, FileBarChart, ScrollText } from "lucide-react";
import { DashboardShell, type NavItem } from "@/components/layout/dashboard-shell";

// Icons are components, so this lives in a client module (a server layout can't pass them down as props).
const NAV: NavItem[] = [
  { href: "/owner", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/owner/bookings", label: "Bookings", icon: CalendarCheck },
  { href: "/owner/hostels", label: "Properties", icon: Building2 },
  { href: "/owner/tenants", label: "Tenants", icon: Users },
  { href: "/owner/rent", label: "Rent", icon: Banknote },
  { href: "/owner/complaints", label: "Complaints", icon: Wrench },
  { href: "/owner/staff", label: "Staff", icon: HardHat },
  { href: "/owner/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/owner/coupons", label: "Coupons", icon: Tag },
  { href: "/owner/reviews", label: "Reviews", icon: MessageSquare },
  { href: "/owner/reports", label: "Reports", icon: FileBarChart },
  { href: "/owner/audit", label: "Activity log", icon: ScrollText },
  { href: "/owner/earnings", label: "Earnings", icon: BarChart3 },
  { href: "/owner/verification", label: "Verification", icon: ShieldCheck },
];
export const OwnerShell = ({ children }: { children: React.ReactNode }) => <DashboardShell title="Host" items={NAV}>{children}</DashboardShell>;
