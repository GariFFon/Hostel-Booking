"use client";
import { Building2, CalendarCheck, LayoutDashboard, MessageSquare, ScrollText, ShieldCheck, Sparkles, Tag } from "lucide-react";
import { DashboardShell, type NavItem } from "@/components/layout/dashboard-shell";

const NAV: NavItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/hostels", label: "Listings", icon: Building2 },
  { href: "/admin/kyc", label: "Host verification", icon: ShieldCheck },
  { href: "/admin/bookings", label: "Bookings", icon: CalendarCheck },
  { href: "/admin/reviews", label: "Reviews", icon: MessageSquare },
  { href: "/admin/coupons", label: "Coupons", icon: Tag },
  { href: "/admin/amenities", label: "Amenities", icon: Sparkles },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
];
export const AdminShell = ({ children }: { children: React.ReactNode }) => <DashboardShell title="Admin" items={NAV}>{children}</DashboardShell>;
