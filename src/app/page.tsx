import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { userFromCookieHeader } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const cookieStore = await cookies();
  const user = await userFromCookieHeader(cookieStore.toString());

  if (!user) redirect("/sign-in");
  redirect(user.role === "admin" ? "/admin/campaigns" : "/campaigns");
}
