import { z } from "zod";

// Mirrors the backend rules so people get the message before the round trip; the backend remains the authority.
export const emailField = z.string().trim().toLowerCase().min(1, "Enter your email").email("Enter a valid email address").max(254);
export const passwordField = z.string().min(8, "Use at least 8 characters").max(128, "Use at most 128 characters").regex(/[A-Za-z]/, "Include a letter").regex(/\d/, "Include a number");
export const phoneField = z.string().trim().regex(/^\+?[1-9]\d{7,14}$/, "Use international format, e.g. +919876543210");

export const loginSchema = z.object({ email: emailField, password: z.string().min(1, "Enter your password").max(128) });
export const registerSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name").max(100),
  email: emailField,
  phone: z.union([z.literal(""), phoneField]).optional(),
  password: passwordField,
  role: z.enum(["GUEST", "OWNER"]),
});
export const forgotSchema = z.object({ email: emailField });
export const resetSchema = z.object({ password: passwordField, confirm: z.string() }).refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" });
