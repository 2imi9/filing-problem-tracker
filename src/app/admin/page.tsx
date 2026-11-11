import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { homeFor } from "@/components/shell/nav";
import { Page } from "@/components/shell/Page";
import { LinkButton } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { getSession } from "@/server/auth/session";
import { AdminConsole } from "./AdminConsole";

export const metadata: Metadata = { title: "Admin" };

// The role is checked here, on the server, before any of the admin screen is sent. The admin API routes
// check it again on every request.
async function AdminOnly() {
  const session = await getSession();
  if (!session) redirect("/login?next=/admin");
  if (session.role !== "admin") {
    return (
      <EmptyState title="This page is for administrators" action={<LinkButton href={homeFor(session.role)}>Go back to your start page</LinkButton>}>
        Your account does not have the administrator role, so there is nothing here for you to change.
      </EmptyState>
    );
  }
  return <AdminConsole />;
}

export default function AdminPage() {
  return (
    <Page title="Admin" intro="The changes the before and after panel can measure, and the record of who changed what.">
      <Suspense fallback={<Spinner label="Checking your access" announce />}>
        <AdminOnly />
      </Suspense>
    </Page>
  );
}
