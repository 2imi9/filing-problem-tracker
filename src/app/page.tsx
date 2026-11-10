import { redirect } from "next/navigation";
import { Suspense } from "react";
import { homeFor } from "@/components/shell/nav";
import { Spinner } from "@/components/ui/Spinner";
import { getSession } from "@/server/auth/session";

// The front door. It has no content of its own: clerks go to Tag a filing, everyone else to the dashboard.
// The session is read at request time, so the redirect sits behind a Suspense boundary.
async function RedirectByRole(): Promise<never> {
  const session = await getSession();
  redirect(session ? homeFor(session.role) : "/login");
}

export default function HomePage() {
  return (
    <>
      <h1 className="visually-hidden">Filing Problem Tracker</h1>
      <Suspense fallback={<Spinner label="Opening the tracker" announce />}>
        <RedirectByRole />
      </Suspense>
    </>
  );
}
