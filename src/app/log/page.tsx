import type { Metadata } from "next";
import { Page } from "@/components/shell/Page";
import { TagFiling } from "./TagFiling";

export const metadata: Metadata = { title: "Tag a filing" };

export default function LogPage() {
  return (
    <Page
      title="Tag a filing"
      intro="A filing is sent back. Tag what was wrong in a few clicks, with no names or case numbers."
    >
      <TagFiling />
    </Page>
  );
}
