"use client";

import { useState } from "react";
import { apiFetch, errorMessage } from "@/components/data/apiClient";
import { DataGate, useLoadedData } from "@/components/data/DataProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import type { OkResponse } from "@/lib/api";
import { AuditLog } from "./AuditLog";
import { ChangeEvents } from "./ChangeEvents";
import styles from "./admin.module.css";

function DemoReset({ onReset }: { onReset: () => void }) {
  const { refresh } = useLoadedData();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);

  const reset = async () => {
    setResetting(true);
    try {
      await apiFetch<OkResponse>("/api/demo/reset", { method: "POST" });
      toast({ message: "Demo data reset to the 900 sample filings.", tone: "success" });
      onReset();
      await refresh();
    } catch (caught) {
      toast({ message: `The demo data was not reset. ${errorMessage(caught)}`, tone: "error" });
    } finally {
      setResetting(false);
      setConfirming(false);
    }
  };

  return (
    <Card title="Demo data">
      <p>
        Puts the tracker back to the made-up sample: 900 filings and three changes. Everything added since the server started is removed, for every demo
        account: tagged filings, imports, changes, saved folders and the audit log.
      </p>
      <div>
        <Button variant="danger" icon="refresh" onClick={() => setConfirming(true)}>
          Reset demo data
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Reset the demo data?"
        confirmLabel="Reset demo data"
        tone="danger"
        busy={resetting}
        onConfirm={() => void reset()}
        onCancel={() => setConfirming(false)}
      >
        Everything added in this demo is removed for every demo account. This cannot be undone.
      </ConfirmDialog>
    </Card>
  );
}

function Console() {
  const { mode } = useLoadedData();
  // Bumped whenever something that writes to the audit log happens here, so the log loads again.
  const [auditVersion, setAuditVersion] = useState(0);
  const touch = () => setAuditVersion((value) => value + 1);

  return (
    <div className={styles.stack}>
      <ChangeEvents onChanged={touch} />
      <AuditLog version={auditVersion} />
      {mode === "demo" ? <DemoReset onReset={touch} /> : null}
    </div>
  );
}

export function AdminConsole() {
  return (
    <DataGate>
      <Console />
    </DataGate>
  );
}
