import type { Metadata } from "next";
import { Page } from "@/components/shell/Page";
import { ImportTool } from "./ImportTool";

export const metadata: Metadata = { title: "Import a rejection export" };

export default function ImportPage() {
  return (
    <Page
      title="Import a rejection export"
      intro="For records the court already has. Paste or upload a spreadsheet export of past rejections, saved as CSV. The tracker reads the reason the clerk typed and sorts it into the same problem categories. Rows it cannot sort are marked for a person to review."
    >
      <ImportTool />
    </Page>
  );
}
