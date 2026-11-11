import type { Metadata } from "next";
import { Page } from "@/components/shell/Page";
import { ImportTool } from "./ImportTool";

export const metadata: Metadata = { title: "Import a rejection export" };

export default function ImportPage() {
  return (
    <Page
      title="Import a rejection export"
      intro="Paste a spreadsheet export of past rejections. Each typed reason is sorted into the same problem list."
    >
      <ImportTool />
    </Page>
  );
}
