import type { Metadata } from "next";
import { Page } from "@/components/shell/Page";
import { Dashboard } from "./Dashboard";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <Page
      title="Dashboard"
      intro="Which problems are most common, where, on which forms, and whether a change helped."
    >
      <Dashboard />
    </Page>
  );
}
