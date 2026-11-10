"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, apiFetch, errorMessage } from "@/components/data/apiClient";
import { useLoadedData } from "@/components/data/DataProvider";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorSummary } from "@/components/ui/ErrorSummary";
import type { SummaryError } from "@/components/ui/ErrorSummary";
import { TextInput } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import type { OkResponse } from "@/lib/api";
import { CASE_TYPES, COUNTIES, MIN_DATE, TAGS, isCaseType, isCounty, isTag } from "@/lib/domain";
import type { CaseType, ChangeEvent, County, Tag } from "@/lib/domain";
import { describePersonalData, findPersonalData } from "@/lib/pii";
import { EVENT_DESCRIPTION_MAX, EVENT_NAME_MAX } from "@/lib/schemas";
import type { ChangeEventInput } from "@/lib/schemas";
import { formatDate, isIsoDate } from "@/lib/time";
import styles from "./admin.module.css";

const FIELD_IDS = {
  name: "event-name",
  date: "event-date",
  county: "event-county",
  caseType: "event-case-type",
  tag: "event-tag",
  description: "event-description",
} as const;
type FieldKey = keyof typeof FIELD_IDS;
type FieldErrors = Partial<Record<FieldKey, string>>;
const isFieldKey = (value: string): value is FieldKey => value in FIELD_IDS;

function AddChange({ onAdded }: { onAdded: () => void }) {
  const { todayIso, refresh } = useLoadedData();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayIso);
  const [county, setCounty] = useState<County>(COUNTIES[0]);
  const [caseType, setCaseType] = useState<CaseType>(CASE_TYPES[0]);
  const [tag, setTag] = useState<Tag>(TAGS[0]);
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const focusSummary = useRef(false);

  const summary = useMemo<SummaryError[]>(() => {
    const items: SummaryError[] = (Object.keys(FIELD_IDS) as FieldKey[]).flatMap((key) => {
      const message = errors[key];
      return message ? [{ message, fieldId: FIELD_IDS[key] }] : [];
    });
    return formError ? [...items, { message: formError }] : items;
  }, [errors, formError]);

  useEffect(() => {
    if (focusSummary.current && summary.length > 0) {
      focusSummary.current = false;
      summaryRef.current?.focus();
    }
  }, [summary]);

  const fail = (fieldErrors: FieldErrors, message: string | null = null) => {
    focusSummary.current = true;
    setErrors(fieldErrors);
    setFormError(message);
  };

  // A change is read by everyone, so a name in it would be seen by everyone. Warn while typing.
  const personal = useMemo(() => findPersonalData(`${name}. ${description}`), [name, description]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const found: FieldErrors = {};
    if (name.trim() === "") found.name = "Give the change a name.";
    if (!isIsoDate(date)) found.date = "Enter the date the change took effect.";
    else if (date > todayIso) found.date = "The date cannot be in the future.";
    else if (date < MIN_DATE) found.date = "The date cannot be before 2020.";
    if (description.trim() === "") found.description = "Describe the change in a sentence.";
    if (Object.keys(found).length > 0) {
      fail(found);
      return;
    }

    const input: ChangeEventInput = { name: name.trim(), date, county, caseType, tag, description: description.trim() };
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      const saved = await apiFetch<ChangeEvent>("/api/events", { method: "POST", body: input });
      toast({ message: `Added the change "${saved.name}".`, tone: "success" });
      setName("");
      setDescription("");
      onAdded();
      void refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "invalid_input" && caught.issues.length > 0) {
        const fromServer: FieldErrors = {};
        const other: string[] = [];
        for (const issue of caught.issues) {
          const key = issue.path.split(".")[0];
          if (isFieldKey(key)) fromServer[key] ??= issue.message;
          else other.push(issue.message);
        }
        fail(fromServer, other.length > 0 ? other.join(" ") : null);
      } else if (caught instanceof ApiError && caught.code === "personal_data") {
        const found = caught.findings.map((finding) => `"${finding.match}"`).join(", ");
        fail({}, `${caught.message}${found ? ` Found: ${found}.` : ""} Take it out and add the change again.`);
      } else {
        fail({}, `The change was not added. ${errorMessage(caught)}`);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Add a change" headingLevel={3} className={styles.addChange}>
      <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
        <ErrorSummary ref={summaryRef} errors={summary} title="The change was not added" />
        {/* The name and the description have a hint line, so each gets a row of its own. The four fields
            between them have none and share a row, with labels and controls level. */}
        <TextInput
          id={FIELD_IDS.name}
          className={styles.nameField}
          label="Name"
          value={name}
          onChange={setName}
          maxLength={EVENT_NAME_MAX}
          hint="Short, with the place and date. For example: Revised small claims form (Marion, Jun 1)."
          error={errors.name}
          required
        />
        <div className={styles.fields}>
          <TextInput
            id={FIELD_IDS.date}
            label="Date it took effect"
            type="date"
            mono
            value={date}
            onChange={setDate}
            min={MIN_DATE}
            max={todayIso}
            error={errors.date}
            required
          />
          <Select
            id={FIELD_IDS.county}
            label="County"
            value={county}
            onChange={(value) => {
              if (isCounty(value)) setCounty(value);
            }}
            options={COUNTIES}
            error={errors.county}
          />
          <Select
            id={FIELD_IDS.caseType}
            label="Case type"
            value={caseType}
            onChange={(value) => {
              if (isCaseType(value)) setCaseType(value);
            }}
            options={CASE_TYPES}
            error={errors.caseType}
          />
          <Select
            id={FIELD_IDS.tag}
            label="Problem it was meant to reduce"
            value={tag}
            onChange={(value) => {
              if (isTag(value)) setTag(value);
            }}
            options={TAGS}
            error={errors.tag}
          />
        </div>
        <TextInput
          id={FIELD_IDS.description}
          label="Description"
          value={description}
          onChange={setDescription}
          maxLength={EVENT_DESCRIPTION_MAX}
          hint={`One or two sentences on what changed, up to ${EVENT_DESCRIPTION_MAX} characters. Every signed-in person can read it. Do not include names.`}
          error={errors.description}
          required
        />
        <div aria-live="polite">
          {personal.length > 0 ? (
            <Alert tone="warning" title={describePersonalData(personal)}>
              Found: {personal.map((finding) => `"${finding.match}"`).join(", ")}. Case numbers, phone numbers, email addresses and street addresses are refused when you save. Something that only looks like a person&apos;s name is allowed when it is the name of a form, a place or a program.
            </Alert>
          ) : null}
        </div>
        <div>
          {/* The one gold button on this page. */}
          <Button type="submit" variant="accent" loading={saving}>
            Add change
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function ChangeEvents({ onChanged }: { onChanged: () => void }) {
  const { events, refresh } = useLoadedData();
  const { toast } = useToast();
  const [target, setTarget] = useState<ChangeEvent | null>(null);
  const [deleting, setDeleting] = useState(false);

  const sorted = useMemo(() => [...events].sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name)), [events]);

  const remove = async () => {
    if (!target) return;
    setDeleting(true);
    try {
      await apiFetch<OkResponse>(`/api/events/${encodeURIComponent(target.id)}`, { method: "DELETE" });
      toast({ message: `Deleted the change "${target.name}".`, tone: "success" });
      onChanged();
      await refresh();
    } catch (caught) {
      toast({ message: `The change was not deleted. ${errorMessage(caught)}`, tone: "error" });
    } finally {
      setDeleting(false);
      setTarget(null);
    }
  };

  return (
    <Card title="Changes" note={`${sorted.length} on file`}>
      <p className={styles.lead}>A change is something a court did to reduce a problem: a revised form, a guide, a kiosk. The before and after panel compares the months on each side of its date.</p>

      {sorted.length === 0 ? (
        <EmptyState title="No changes on file" icon="calendar" compact>
          Add one below and the before and after panel can measure it.
        </EmptyState>
      ) : (
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Changes on file">
          <table className={`data-table ${styles.changesTable}`}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Date</th>
                <th scope="col">County</th>
                <th scope="col">Case type</th>
                <th scope="col">Problem</th>
                <th scope="col">Description</th>
                <th scope="col">
                  <span className="visually-hidden">Delete</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((event) => (
                <tr key={event.id}>
                  <th scope="row" className={styles.nameCell}>
                    {event.name}
                  </th>
                  <td className="code">
                    <time dateTime={event.date}>{formatDate(event.date)}</time>
                  </td>
                  <td>{event.county}</td>
                  <td>{event.caseType}</td>
                  <td>{event.tag}</td>
                  <td className={styles.descriptionCell}>{event.description}</td>
                  <td className={styles.actionCell}>
                    <Button size="sm" variant="danger" onClick={() => setTarget(event)}>
                      Delete<span className="visually-hidden">: {event.name}</span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddChange onAdded={onChanged} />

      <ConfirmDialog
        open={target !== null}
        title="Delete this change?"
        confirmLabel="Delete change"
        tone="danger"
        busy={deleting}
        onConfirm={() => void remove()}
        onCancel={() => setTarget(null)}
      >
        {target ? `"${target.name}" will no longer be offered in the before and after panel. Saved workspace panels that use it will show that the change is missing. The flagged filings are not affected.` : null}
      </ConfirmDialog>
    </Card>
  );
}
