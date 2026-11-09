import { z } from "zod";
import type { Data } from "@/lib/api/types";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour time, like 14:00");
const optional = (re: RegExp, msg: string) => z.union([z.literal(""), z.string().trim().regex(re, msg)]).optional();

/** Mirrors the backend rules so people see the problem next to the field; the backend stays the authority. */
export const hostelFormSchema = z.object({
  name: z.string().trim().min(3, "Give it a name of at least 3 characters").max(100),
  propertyType: z.enum(["HOSTEL", "PG"]),
  description: z.string().trim().min(20, "Describe your property in at least 20 characters").max(4000),
  addressLine1: z.string().trim().min(3, "Enter the street address").max(200),
  addressLine2: z.string().trim().max(200).optional(),
  locality: z.string().trim().max(100).optional(),
  city: z.string().trim().min(2, "Enter the city").max(80),
  state: z.string().trim().min(2, "Enter the state").max(80),
  postalCode: z.string().trim().regex(/^\d{6}$/, "Indian PIN codes have 6 digits"),
  latitude: z.number({ error: "Pin the location on the map" }).min(-90).max(90),
  longitude: z.number({ error: "Pin the location on the map" }).min(-180).max(180),
  phone: optional(/^\+?[1-9]\d{7,14}$/, "Use international format, e.g. +919876543210"),
  contactEmail: z.union([z.literal(""), z.string().trim().email("Enter a valid email")]).optional(),
  checkInTime: hhmm, checkOutTime: hhmm,
  bookingMode: z.enum(["INSTANT", "APPROVAL"]),
  cancellationPolicy: z.enum(["FLEXIBLE", "MODERATE", "STRICT"]),
  genderPolicy: z.enum(["MIXED", "MALE_ONLY", "FEMALE_ONLY"]),
  houseRules: z.string().trim().max(3000).optional(),
  gstin: optional(/^\d{2}[A-Za-z]{5}\d{4}[A-Za-z][1-9A-Za-z]Z[0-9A-Za-z]$/, "Enter a valid 15-character GSTIN"),
  amenityCodes: z.array(z.string()).max(40),
});
export type HostelFormValues = z.infer<typeof hostelFormSchema>;

export const DEFAULTS: Partial<HostelFormValues> = {
  name: "", propertyType: "HOSTEL", description: "", addressLine1: "", addressLine2: "", locality: "", city: "", state: "", postalCode: "",
  phone: "", contactEmail: "", checkInTime: "14:00", checkOutTime: "11:00", bookingMode: "INSTANT", cancellationPolicy: "MODERATE", genderPolicy: "MIXED", houseRules: "", gstin: "", amenityCodes: [],
};

type Hostel = Data<"/owner/hostels/{id}">;
export const fromHostel = (h: Hostel): HostelFormValues => ({
  name: h.name, propertyType: h.propertyType, description: h.description, addressLine1: h.address.line1, addressLine2: h.address.line2 ?? "", locality: h.address.locality ?? "",
  city: h.address.city, state: h.address.state, postalCode: h.address.postalCode, latitude: h.location.latitude, longitude: h.location.longitude,
  phone: h.phone ?? "", contactEmail: h.contactEmail ?? "", checkInTime: h.checkInTime, checkOutTime: h.checkOutTime, bookingMode: h.bookingMode,
  cancellationPolicy: h.cancellationPolicy, genderPolicy: h.genderPolicy, houseRules: h.houseRules ?? "", gstin: h.gstin ?? "", amenityCodes: h.amenities.map((a) => a.code),
});

/** Empty strings become null (the API's way of "not set"); everything else is sent as typed. */
export const toPayload = (v: HostelFormValues) => ({
  name: v.name, propertyType: v.propertyType, description: v.description, bookingMode: v.bookingMode, cancellationPolicy: v.cancellationPolicy, genderPolicy: v.genderPolicy,
  addressLine1: v.addressLine1, addressLine2: v.addressLine2 || null, locality: v.locality || null, city: v.city, state: v.state, postalCode: v.postalCode, country: "IN", timezone: "Asia/Kolkata",
  latitude: v.latitude, longitude: v.longitude, phone: v.phone || null, contactEmail: v.contactEmail || null, checkInTime: v.checkInTime, checkOutTime: v.checkOutTime,
  houseRules: v.houseRules || null, gstin: v.gstin ? v.gstin.toUpperCase() : null, amenityCodes: v.amenityCodes,
});
