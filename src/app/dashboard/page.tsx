import type { Metadata } from "next";
import { Page } from "@/components/shell/Page";
import { Dashboard } from "./Dashboard";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <Page
      title="Dashboard"
      intro="Which problems are most common, where, and on which forms. The last panel shows whether a problem went down after a form change or a new tool."
    >
      <Dashboard />
    </Page>
  );
}
