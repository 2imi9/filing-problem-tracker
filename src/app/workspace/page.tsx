import type { Metadata } from "next";
import { Page } from "@/components/shell/Page";
import { Workspace } from "@/components/workspace/Workspace";

export const metadata: Metadata = { title: "Workspace" };

export default function WorkspacePage() {
  return (
    <Page
      title="Workspace"
      width="full"
      intro="Say what you want to look at and panels open on a grid. Every number is counted from the flagged filings you are allowed to see. Changing a panel's filters happens on this page and sends nothing anywhere."
    >
      <Workspace />
    </Page>
  );
}
