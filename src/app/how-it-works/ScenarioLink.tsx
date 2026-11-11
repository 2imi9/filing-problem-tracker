"use client";

import type { ReactNode } from "react";
import { useData } from "@/components/data/DataProvider";
import { LinkButton } from "@/components/ui/Button";
import type { Role } from "@/lib/domain";

/** A quiet link under a scenario, shown only to the roles that can open the page it points to. */
export function ScenarioLink({ href, roles, children }: { href: string; roles: readonly Role[]; children: ReactNode }) {
  const { user } = useData();
  if (!user || !roles.includes(user.role)) return null;
  return (
    <div>
      <LinkButton href={href}>{children}</LinkButton>
    </div>
  );
}
