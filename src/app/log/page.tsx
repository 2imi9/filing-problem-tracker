import type { Metadata } from "next";
import { Page } from "@/components/shell/Page";
import { TagFiling } from "./TagFiling";

export const metadata: Metadata = { title: "Tag a filing" };

export default function LogPage() {
  return (
    <Page
      title="Tag a filing"
      intro="When a filing from someone without a lawyer is rejected or sent back, pick the filing details, choose what was wrong, and save. No names or case numbers are needed. It should take a few seconds."
    >
      <TagFiling />
    </Page>
  );
}
