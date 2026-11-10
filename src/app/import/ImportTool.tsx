"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { ApiError, apiFetch, errorMessage } from "@/components/data/apiClient";
import { useLoadedData } from "@/components/data/DataProvider";
import { RoleGate } from "@/components/shell/RoleGate";
import { Alert } from "@/components/ui/Alert";
import { Button, LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip, ChipGroup } from "@/components/ui/Chip";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorSummary } from "@/components/ui/ErrorSummary";
import type { SummaryError } from "@/components/ui/ErrorSummary";
import { Checkbox, TextArea } from "@/components/ui/Field";
import { Pill, TagPill } from "@/components/ui/Pill";
import { useFocusAfterUpdate } from "@/components/ui/useFocusAfterUpdate";
import type { PillTone } from "@/components/ui/Pill";
import type { Confidence, ImportCommitResponse, ImportPreviewResponse, ImportPreviewRow } from "@/lib/api";
import { MAX_CSV_BYTES, MAX_CSV_ROWS } from "@/lib/csv";
import type { RejectedRow } from "@/lib/csv";
import { NEEDS_REVIEW, TAGS } from "@/lib/domain";
import type { FlagTag, Tag } from "@/lib/domain";
import { PII_LABELS } from "@/lib/pii";
import { sampleCsv } from "@/lib/sample";
import type { ImportRow } from "@/lib/schemas";
import { NeedsReviewList } from "./NeedsReviewList";
import styles from "./import.module.css";

const CSV_FIELD = "import-csv";
/** A very large file is added in full, but only this many rows are drawn in each table. */
const ROWS_SHOWN = 200;
const TOO_LARGE = "This file is larger than 5 MB. Split it into smaller files and add them one at a time.";

/** A preview row, plus whether a person changed its problems. */
interface ReviewRow extends ImportPreviewRow {
  edited: boolean;
}

interface Result {
  inserted: number;
  needsReview: number;
}

const CONFIDENCE_TONES: Record<Confidence, PillTone> = { high: "success", medium: "neutral", low: "warning" };
const CONFIDENCE_LABELS: Record<Confidence, string> = { high: "High", medium: "Medium", low: "Low" };

const count = (n: number) => n.toLocaleString("en-US");
const rowsWord = (n: number) => `${count(n)} ${n === 1 ? "row" : "rows"}`;
const needsReview = (row: { tags: readonly FlagTag[] }) => row.tags.includes(NEEDS_REVIEW);

function toImportRow(row: ReviewRow): ImportRow {
  return { date: row.date, county: row.county, caseType: row.caseType, form: row.form, reason: row.reason, tags: row.tags };
}

interface EditDialogProps {
  row: ReviewRow | null;
  onApply: (line: number, tags: FlagTag[]) => void;
  onClose: () => void;
}

function EditProblems({ row, onApply, onClose }: { row: ReviewRow; onApply: EditDialogProps["onApply"]; onClose: () => void }) {
  const [chosen, setChosen] = useState<Tag[]>(() => TAGS.filter((tag) => row.tags.includes(tag)));
  const toggle = (tag: Tag) => setChosen((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]));
  return (
    <>
      <div>
        <p className={styles.dialogLabel}>Clerk&apos;s reason, as typed</p>
        <p className={styles.reason}>{row.reason || "(blank)"}</p>
      </div>
      <ChipGroup label="What was wrong? Choose all that apply." hint="Leave every problem off to mark the row Needs review.">
        {TAGS.map((tag) => (
          <Chip key={tag} pressed={chosen.includes(tag)} onPressedChange={() => toggle(tag)}>
            {tag}
          </Chip>
        ))}
      </ChipGroup>
      <div className={styles.dialogActions}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => onApply(row.line, chosen.length > 0 ? TAGS.filter((tag) => chosen.includes(tag)) : [NEEDS_REVIEW])}>
          Use these problems
        </Button>
      </div>
    </>
  );
}

function EditDialog({ row, onApply, onClose }: EditDialogProps) {
  return (
    <Dialog open={row !== null} onClose={onClose} title={row ? `Problems for row ${count(row.line)}` : "Problems"} size="lg">
      {row ? <EditProblems key={row.line} row={row} onApply={onApply} onClose={onClose} /> : null}
    </Dialog>
  );
}

function RejectedTable({ rejected }: { rejected: readonly RejectedRow[] }) {
  const shown = rejected.slice(0, ROWS_SHOWN);
  return (
    <Card title="Rows left out" note={rowsWord(rejected.length)} headingLevel={3}>
      <p>These rows will not be added. Fix them in the spreadsheet and import them again if they are needed.</p>
      <div className={`table-scroll ${styles.tallScroll}`} tabIndex={0} role="region" aria-label="Rows left out">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="num">
                Row
              </th>
              <th scope="col">Date</th>
              <th scope="col">County</th>
              <th scope="col">Case type</th>
              <th scope="col">Form</th>
              <th scope="col">Why it was left out</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.line}>
                <td className="num">{count(row.line)}</td>
                <td className={`num ${styles.shortCell}`}>{row.date || "(blank)"}</td>
                <td className={styles.shortCell}>{row.county || "(blank)"}</td>
                <td className={styles.shortCell}>{row.caseType || "(blank)"}</td>
                <td className={styles.formCell}>{row.form || "(blank)"}</td>
                <td>
                  <ul className={styles.problems}>
                    {row.problems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rejected.length > shown.length ? <p className={styles.hint}>Showing the first {count(shown.length)} of {rowsWord(rejected.length)}.</p> : null}
    </Card>
  );
}

function ImportForm() {
  const { user, mode, ai, refresh } = useLoadedData();
  const [csv, setCsv] = useState("");
  const [useAi, setUseAi] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [errors, setErrors] = useState<SummaryError[]>([]);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [askedForAi, setAskedForAi] = useState(false);
  const [onlyReview, setOnlyReview] = useState(false);
  const [editingLine, setEditingLine] = useState<number | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  // Bumped after a successful import so the needs-review list loads again.
  const [reviewVersion, setReviewVersion] = useState(0);

  const fileRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  // "Add rows" and "Discard preview" remove the preview they sit in, themselves included.
  const focusAfterUpdate = useFocusAfterUpdate();
  const focusSummary = useRef(false);
  const focusPreview = useRef(false);

  useEffect(() => {
    if (focusSummary.current && errors.length > 0) {
      focusSummary.current = false;
      summaryRef.current?.focus();
    }
  }, [errors]);

  // When a preview arrives, move to it: on a small screen it is below the fold.
  useEffect(() => {
    if (focusPreview.current && preview) {
      focusPreview.current = false;
      previewRef.current?.focus();
    }
  }, [preview]);

  const fail = (items: SummaryError[]) => {
    focusSummary.current = true;
    setErrors(items);
  };

  const clerkCounty = user.role === "clerk" ? user.county : null;
  const reviewCount = useMemo(() => rows.filter(needsReview).length, [rows]);
  const visible = useMemo(() => (onlyReview ? rows.filter(needsReview) : rows), [rows, onlyReview]);
  const shown = visible.slice(0, ROWS_SHOWN);
  const editingRow = editingLine === null ? null : (rows.find((row) => row.line === editingLine) ?? null);
  const busy = sorting || adding;

  const sort = async (text: string) => {
    if (busy) return;
    setResult(null);
    if (text.trim() === "") {
      fail([{ message: "Paste the export, or upload a CSV file.", fieldId: CSV_FIELD }]);
      return;
    }
    if (new TextEncoder().encode(text).length > MAX_CSV_BYTES) {
      fail([{ message: TOO_LARGE, fieldId: CSV_FIELD }]);
      return;
    }
    const wantAi = useAi && ai;
    setSorting(true);
    setErrors([]);
    try {
      const response = await apiFetch<ImportPreviewResponse>("/api/import/preview", { method: "POST", body: { csv: text, useAi: wantAi } });
      focusPreview.current = true;
      setAskedForAi(wantAi);
      setOnlyReview(false);
      setRows(response.rows.map((row) => ({ ...row, edited: false })));
      setPreview(response);
    } catch (caught) {
      setPreview(null);
      setRows([]);
      const inFile = caught instanceof ApiError && (caught.code === "invalid_csv" || caught.code === "payload_too_large");
      fail([{ message: errorMessage(caught), fieldId: inFile ? CSV_FIELD : undefined }]);
    } finally {
      setSorting(false);
    }
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset the control so choosing the same file again fires a change.
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_CSV_BYTES) {
      fail([{ message: TOO_LARGE, fieldId: CSV_FIELD }]);
      return;
    }
    try {
      const text = await file.text();
      setCsv(text);
      await sort(text);
    } catch {
      fail([{ message: "That file could not be read. Save the spreadsheet as CSV and try again.", fieldId: CSV_FIELD }]);
    }
  };

  const applyEdit = (line: number, tags: FlagTag[]) => {
    setRows((current) => current.map((row) => (row.line === line ? { ...row, tags, edited: true } : row)));
    setEditingLine(null);
  };

  const add = async () => {
    if (busy || rows.length === 0) return;
    setAdding(true);
    setErrors([]);
    const sent = rows;
    try {
      const response = await apiFetch<ImportCommitResponse>("/api/import/commit", { method: "POST", body: { rows: sent.map(toImportRow) } });
      setResult({ inserted: response.inserted, needsReview: sent.filter(needsReview).length });
      setPreview(null);
      setRows([]);
      setCsv("");
      setReviewVersion((value) => value + 1);
      focusAfterUpdate(() => resultRef.current);
      void refresh();
    } catch (caught) {
      // The server names rows by their position in what was sent; show the spreadsheet row instead.
      const lineOf = (index: number) => (sent[index] ? `Row ${count(sent[index].line)}` : "A row");
      if (caught instanceof ApiError && caught.code === "personal_data" && caught.rows.length > 0) {
        fail([
          { message: caught.message },
          ...caught.rows.map(({ row, findings }) => ({
            message: `${lineOf(row)}: the reason looks like it contains ${[...new Set(findings.map((finding) => PII_LABELS[finding.kind]))].join(", ")}.`,
          })),
        ]);
      } else if (caught instanceof ApiError && caught.code === "invalid_input" && caught.issues.length > 0) {
        fail([
          { message: "Nothing was added. Some rows were refused." },
          ...caught.issues.map((issue) => {
            const [scope, index] = issue.path.split(".");
            return { message: scope === "rows" && index !== undefined ? `${lineOf(Number(index))}: ${issue.message}` : issue.message };
          }),
        ]);
      } else {
        fail([{ message: `Nothing was added. ${errorMessage(caught)}` }]);
      }
    } finally {
      setAdding(false);
    }
  };

  if (user.role === "clerk" && !clerkCounty) {
    return (
      <Alert tone="error" title="Your account has no county assigned.">
        A clerk can only import rows for their own county. Ask an administrator to set the county on your account.
      </Alert>
    );
  }

  return (
    <div className={styles.stack}>
      <Card title="Rejection export">
        <ErrorSummary ref={summaryRef} errors={errors} title="The import could not continue" />

        <p>
          Expected columns: <span className="num">date, county, case_type, form, reason</span>. Dates look like <span className="num">2026-09-02</span>. One file can
          hold up to {count(MAX_CSV_ROWS)} rows or 5 MB.
          {clerkCounty ? ` You can add rows for ${clerkCounty} County only; rows for other counties are left out.` : ""}
        </p>
        <p>Do not import names, case numbers, addresses or phone numbers. A row whose reason looks like it contains one is left out.</p>

        <TextArea
          id={CSV_FIELD}
          label="CSV text"
          value={csv}
          onChange={setCsv}
          rows={9}
          mono
          error={errors.find((error) => error.fieldId === CSV_FIELD)?.message}
          hint="Paste the export here, including the header row."
        />

        <Checkbox
          label="Use AI sorting"
          checked={useAi && ai}
          onChange={setUseAi}
          disabled={!ai}
          hint={
            ai
              ? "An AI model reads each reason and picks the problems. A reason that looks like it contains personal data is never sent to it. Without AI, keyword rules do the sorting."
              : "AI sorting is switched off on this server. Keyword rules do the sorting."
          }
        />

        <div className={styles.actions}>
          <Button variant="primary" loading={sorting} disabled={adding} onClick={() => void sort(csv)}>
            Sort into categories
          </Button>
          <Button icon="upload" disabled={busy} onClick={() => fileRef.current?.click()}>
            Upload a CSV file
          </Button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(event) => void onFile(event)} data-testid="import-file" />
          {mode === "demo" ? (
            <Button variant="ghost" disabled={busy} onClick={() => setCsv(sampleCsv(clerkCounty ?? undefined))}>
              Fill with the made-up example
            </Button>
          ) : null}
        </div>
        <p className={styles.hint}>Sorting only shows a preview. Nothing is added until you choose Add rows.</p>
      </Card>

      {result ? (
        <div ref={resultRef} tabIndex={-1} className={styles.previewAnchor}>
          <Alert tone="success" title={`Added ${rowsWord(result.inserted)}.`} live action={<LinkButton href="/dashboard">Open the dashboard</LinkButton>}>
            {result.needsReview > 0
              ? `${rowsWord(result.needsReview)} could not be sorted and ${result.needsReview === 1 ? "is" : "are"} listed under Needs review below.`
              : "Every row was sorted into at least one problem."}
          </Alert>
        </div>
      ) : null}

      {preview ? (
        <div ref={previewRef} tabIndex={-1} className={styles.previewAnchor}>
          <Card
            title="Preview"
            note={`${rowsWord(preview.summary.read)} read, ${count(rows.length - reviewCount)} sorted, ${count(reviewCount)} need review, ${count(preview.summary.rejected)} left out`}
          >
            {askedForAi && preview.classifier.used === "rules" ? (
              <Alert tone="info" title="Keyword rules did the sorting.">
                AI sorting was asked for but did not answer for this file.
              </Alert>
            ) : null}

            {rows.length === 0 ? (
              <Alert tone="warning" title="No rows can be added.">
                Every row in this file was left out. The reasons are listed below.
              </Alert>
            ) : (
              <>
                {reviewCount > 0 ? (
                  <Checkbox label={`Show only the ${rowsWord(reviewCount)} that need review`} checked={onlyReview} onChange={setOnlyReview} />
                ) : null}
                <div className={`table-scroll ${styles.tallScroll}`} tabIndex={0} role="region" aria-label="Preview of rows to add">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col" className="num">
                          Row
                        </th>
                        <th scope="col">Date</th>
                        <th scope="col">County</th>
                        <th scope="col">Case type</th>
                        <th scope="col">Form</th>
                        <th scope="col">Clerk&apos;s reason (as typed)</th>
                        <th scope="col">Sorted into</th>
                        <th scope="col">Sorted by</th>
                        <th scope="col">Confidence</th>
                        <th scope="col" className={styles.actionCell}>
                          <span className="visually-hidden">Change</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((row) => (
                        <tr key={row.line}>
                          <td className="num">{count(row.line)}</td>
                          <td className={`num ${styles.shortCell}`}>{row.date}</td>
                          <td className={styles.shortCell}>{row.county}</td>
                          <td className={styles.shortCell}>{row.caseType}</td>
                          <td className={styles.formCell}>{row.form}</td>
                          <td className={styles.reasonCell}>{row.reason || "(blank)"}</td>
                          <td>
                            <ul className={styles.tags}>
                              {row.tags.map((tag) => (
                                <li key={tag}>
                                  <TagPill tag={tag} />
                                </li>
                              ))}
                            </ul>
                          </td>
                          <td>{row.edited ? "You" : row.source === "ai" ? "AI" : "Rules"}</td>
                          <td>{row.edited ? <span className="muted">Set by you</span> : <Pill tone={CONFIDENCE_TONES[row.confidence]}>{CONFIDENCE_LABELS[row.confidence]}</Pill>}</td>
                          <td className={styles.actionCell}>
                            <Button size="sm" variant="ghost" icon="edit" disabled={busy} onClick={() => setEditingLine(row.line)}>
                              Change<span className="visually-hidden"> problems for row {count(row.line)}</span>
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {visible.length > shown.length ? (
                  <p className={styles.hint}>
                    Showing the first {count(shown.length)} of {rowsWord(visible.length)}. All {rowsWord(rows.length)} will be added.
                  </p>
                ) : null}

                <div className={styles.actions}>
                  <Button variant="accent" loading={adding} onClick={() => void add()}>
                    Add {rowsWord(rows.length)} to the tracker
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setPreview(null);
                      setRows([]);
                      focusAfterUpdate(() => document.getElementById(CSV_FIELD));
                    }}
                  >
                    Discard preview
                  </Button>
                </div>
                <p className={styles.hint}>
                  Imported rows are saved with the outcome Rejected. Rows marked Needs review are added with that label so a clerk can see them later.
                </p>
              </>
            )}

            {preview.rejected.length > 0 ? <RejectedTable rejected={preview.rejected} /> : null}
          </Card>
        </div>
      ) : null}

      <NeedsReviewList version={reviewVersion} />

      <EditDialog row={editingRow} onApply={applyEdit} onClose={() => setEditingLine(null)} />
    </div>
  );
}

export function ImportTool() {
  return (
    <RoleGate
      allow={["clerk", "admin"]}
      title="Importing is done by clerks"
      message="Court leaders can read the dashboard and the workspace, but cannot add filings."
    >
      <ImportForm />
    </RoleGate>
  );
}
