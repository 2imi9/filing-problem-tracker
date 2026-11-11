// Shows its children only to the roles that can use them, after the data has loaded.
//
//   <RoleGate allow={["clerk", "admin"]} title="Tagging is done by clerks"
//             message="Court leaders can read the dashboard and workspace but cannot add filings.">
//     <LogForm />
//   </RoleGate>
//
// This is a courtesy for the person, not the access check: the API refuses the same requests on the server.
// It includes DataGate, so children can call useLoadedData().

"use client";

import type { ReactNode } from "react";
import { DataGate, useLoadedData } from "@/components/data/DataProvider";
import { LinkButton } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import type { Role } from "@/lib/domain";
import { homeFor } from "./nav";

export interface RoleGateProps {
  allow: readonly Role[];
  /** Shown to other roles. */
  title: string;
  message: string;
  children: ReactNode;
}

function Gate({ allow, title, message, children }: RoleGateProps) {
  const { user } = useLoadedData();
  if (allow.includes(user.role)) return <>{children}</>;
  const home = homeFor(user.role);
  return (
    <EmptyState title={title} action={<LinkButton href={home}>Go to the {home === "/log" ? "tagging page" : "dashboard"}</LinkButton>}>
      {message}
    </EmptyState>
  );
}

export function RoleGate(props: RoleGateProps) {
  return (
    <DataGate>
      <Gate {...props} />
    </DataGate>
  );
}
