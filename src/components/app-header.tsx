"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/client";

const ADMIN_NAV = [{ href: "/admin/campaigns", label: "Campaigns" }];
const CREATOR_NAV = [
  { href: "/campaigns", label: "Browse campaigns" },
  { href: "/submissions", label: "My submissions" },
];

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const utils = trpc.useUtils();

  const me = trpc.user.me.useQuery();
  const users = trpc.user.all.useQuery();

  const switchUser = trpc.user.switch.useMutation({
    async onSuccess(user) {
      await utils.invalidate();
      router.replace(user.role === "admin" ? "/admin/campaigns" : "/campaigns");
      router.refresh();
    },
  });

  const nav = me.data?.role === "admin" ? ADMIN_NAV : me.data ? CREATOR_NAV : [];

  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <Link href="/" className="font-semibold tracking-tight">
          ClipMarket
        </Link>

        <nav aria-label="Main" className="flex items-center gap-1">
          {nav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  active ? "bg-secondary font-medium" : "text-muted-foreground hover:bg-accent",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground" id="user-switcher-label">
            Dev user
          </span>
          <Select
            value={me.data?.id ?? ""}
            onValueChange={(userId) => switchUser.mutate({ userId })}
            disabled={users.isPending || switchUser.isPending}
          >
            <SelectTrigger
              aria-labelledby="user-switcher-label"
              className="h-8 w-56 text-xs"
            >
              <SelectValue placeholder="Pick a user" />
            </SelectTrigger>
            <SelectContent>
              {(users.data ?? []).map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.name} · {user.role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </header>
  );
}
