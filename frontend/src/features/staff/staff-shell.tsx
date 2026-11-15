"use client";
import { Wrench } from "lucide-react";
import { DashboardShell, type NavItem } from "@/components/layout/dashboard-shell";

const NAV: NavItem[] = [{ href: "/staff", label: "My jobs", icon: Wrench, exact: true }];
export const StaffShell = ({ children }: { children: React.ReactNode }) => <DashboardShell title="Maintenance" items={NAV}>{children}</DashboardShell>;
