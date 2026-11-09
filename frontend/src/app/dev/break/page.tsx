import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BreakUi } from "@/features/dev/break-ui";

export const instant = false;
/** Dev-only worst-case-data harness (break-ui skill). Does not exist in production builds. */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Suspense><BreakUi /></Suspense>;
}
