import type { Metadata } from "next";
import { Page } from "@/components/shell/Page";
import { Workspace } from "@/components/workspace/Workspace";

export const metadata: Metadata = { title: "Workspace" };

export default function WorkspacePage() {
  return (
    <Page
      title="Workspace"
      width="full"
      intro="Say what you want to look at and panels open on a grid, counted from the filings you may see."
    >
      <Workspace />
    </Page>
  );
}
