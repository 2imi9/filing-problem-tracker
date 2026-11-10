"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent } from "react";
import { ApiError, apiFetch, errorMessage } from "@/components/data/apiClient";
import { useLoadedData } from "@/components/data/DataProvider";
import { RoleGate } from "@/components/shell/RoleGate";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip, ChipGroup } from "@/components/ui/Chip";
import type { ChipTone } from "@/components/ui/Chip";
import { ErrorSummary } from "@/components/ui/ErrorSummary";
import type { SummaryError } from "@/components/ui/ErrorSummary";
import { Checkbox, TextInput } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import type { OkResponse } from "@/lib/api";
import { CASE_TYPES, COUNTIES, MIN_DATE, NOTE_MAX, OUTCOMES, TAGS, formsFor, isCaseType, isCounty, isForm } from "@/lib/domain";
import type { CaseType, County, FlagRecord, Form, Outcome, Tag } from "@/lib/domain";
import { describePersonalData, findPersonalData } from "@/lib/pii";
import type { NewFlagInput } from "@/lib/schemas";
import { isIsoDate } from "@/lib/time";
import { RecentEntries } from "./RecentEntries";
import { numberKeysOn, setNumberKeys, subscribeToNumberKeys } from "./numberKeys";
import styles from "./log.module.css";

// Ids of the controls, so the error summary and the server's field paths can point at them.
const FIELD_IDS = {
  county: "log-county",
  date: "log-date",
  caseType: "log-case-type",
  form: "log-form",
  tags: "log-tags",
  outcome: "log-outcome",
  note: "log-note",
} as const;
type FieldKey = keyof typeof FIELD_IDS;
type FieldErrors = Partial<Record<FieldKey, string>>;

const isFieldKey = (value: string): value is FieldKey => value in FIELD_IDS;

const OUTCOME_TONES: Record<Outcome, ChipTone> = {
  Rejected: "danger",
  "Returned to fix": "warning",
  "Fixed at counter": "success",
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// The server cannot read the browser's saved choice, so it renders the default; the browser corrects it on hydration.
const numberKeysOnServer = () => true;

function TagFilingForm() {
  const { user, todayIso, refresh } = useLoadedData();
  const { toast } = useToast();

  // A clerk's county comes from the account and cannot be changed here. The server enforces it too.
  const lockedCounty = user.role === "clerk" ? user.county : null;
  const [county, setCounty] = useState<County>(lockedCounty ?? COUNTIES[0]);
  const [date, setDate] = useState(todayIso);
  const [caseType, setCaseType] = useState<CaseType>(CASE_TYPES[0]);
  const [form, setForm] = useState<Form>(formsFor(CASE_TYPES[0])[0]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [outcome, setOutcome] = useState<Outcome>("Rejected");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const numberKeys = useSyncExternalStore(subscribeToNumberKeys, numberKeysOn, numberKeysOnServer);
  // What a number key just did, for screen readers: the chip it changed does not have focus.
  const [keyStatus, setKeyStatus] = useState("");
  // Bumped after every save, removal and restore so the recent list loads again.
  const [recentVersion, setRecentVersion] = useState(0);

  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  // When the clerk first touched this entry, to report how long tagging took.
  const startedAt = useRef<number | null>(null);
  const markStarted = () => {
    if (startedAt.current === null) startedAt.current = performance.now();
  };

  const noteFindings = useMemo(() => findPersonalData(note), [note]);

  const summary = useMemo<SummaryError[]>(() => {
    const items: SummaryError[] = (Object.keys(FIELD_IDS) as FieldKey[]).flatMap((key) => {
      const message = errors[key];
      return message ? [{ message, fieldId: FIELD_IDS[key] }] : [];
    });
    return formError ? [...items, { message: formError }] : items;
  }, [errors, formError]);

  // After a failed submit, move focus to the summary so it is read and the links are one Tab away.
  const focusSummary = useRef(false);
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

  const toggleTag = useCallback((tag: Tag) => {
    if (startedAt.current === null) startedAt.current = performance.now();
    setTags((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]));
    setErrors((current) => (current.tags ? { ...current, tags: undefined } : current));
  }, []);

  const clearEntry = () => {
    setKeyStatus("");
    setTags([]);
    setNote("");
    setErrors({});
    setFormError(null);
    startedAt.current = null;
  };

  const changeCaseType = (value: string) => {
    if (!isCaseType(value)) return;
    setCaseType(value);
    // The form list depends on the case type.
    setForm(formsFor(value)[0]);
  };

  const restoreEntry = async (id: string) => {
    try {
      await apiFetch<OkResponse>(`/api/flags/${encodeURIComponent(id)}/restore`, { method: "POST" });
      toast({ message: "Entry put back.", tone: "success" });
    } catch (caught) {
      toast({ message: `The entry could not be put back. ${errorMessage(caught)}`, tone: "error" });
    } finally {
      setRecentVersion((value) => value + 1);
      void refresh();
    }
  };

  const removeEntry = async (id: string) => {
    try {
      await apiFetch<OkResponse>(`/api/flags/${encodeURIComponent(id)}`, { method: "DELETE" });
      toast({ message: "Entry removed.", action: { label: "Put back", onAction: () => void restoreEntry(id) } });
    } catch (caught) {
      toast({ message: `The entry could not be removed. ${errorMessage(caught)}`, tone: "error" });
    } finally {
      setRecentVersion((value) => value + 1);
      void refresh();
    }
  };

  const validate = (): FieldErrors => {
    const found: FieldErrors = {};
    if (!isIsoDate(date)) found.date = "Enter the filing date.";
    else if (date > todayIso) found.date = "The filing date cannot be in the future.";
    else if (date < MIN_DATE) found.date = "The filing date cannot be before 2020.";
    if (tags.length === 0) found.tags = "Choose at least one problem.";
    if (noteFindings.length > 0) found.note = `${describePersonalData(noteFindings)} Remove it, then save.`;
    return found;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const found = validate();
    if (Object.keys(found).length > 0) {
      fail(found);
      return;
    }

    // Problems are sent in list order, whatever order they were clicked in.
    const input: NewFlagInput = { date, county, caseType, form, tags: TAGS.filter((tag) => tags.includes(tag)), outcome };
    const trimmedNote = note.trim();
    if (trimmedNote) input.note = trimmedNote;

    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      const saved = await apiFetch<FlagRecord>("/api/flags", { method: "POST", body: input });
      const seconds = startedAt.current === null ? null : Math.max(1, Math.round((performance.now() - startedAt.current) / 1000));
      const took = seconds === null ? "" : ` in ${plural(seconds, "second", "seconds")}`;
      toast({
        message: `Saved. ${plural(saved.tags.length, "problem", "problems")} logged${took}.`,
        tone: "success",
        action: { label: "Undo", onAction: () => void removeEntry(saved.id) },
      });
      clearEntry();
      setRecentVersion((value) => value + 1);
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
        fail({ note: `${caught.message} Remove it, then save.` });
      } else {
        fail({}, `Not saved. ${errorMessage(caught)}`);
      }
    } finally {
      setSaving(false);
    }
  };

  // Keyboard: 1 to 9 toggle the problems (unless the person has turned that off), Enter saves. Keys typed
  // into a field are left alone, and so are keys pressed outside the entry: in the menu, the header or the
  // recent list.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
      if (document.querySelector("dialog[open]")) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const tagName = target?.tagName ?? "";
      const inField = tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || target?.isContentEditable === true;

      const onPage = target === null || target === document.body || target.id === "main" || formRef.current?.contains(target) === true;

      if (/^[1-9]$/.test(event.key)) {
        const tag = TAGS[Number(event.key) - 1];
        if (!numberKeys || inField || !onPage || !tag) return;
        event.preventDefault();
        setKeyStatus(`${tag} ${tags.includes(tag) ? "cleared" : "selected"}.`);
        toggleTag(tag);
        return;
      }

      if (event.key !== "Enter" || inField) return;
      // On a problem chip, Enter saves (Space toggles the chip). Every other button and link keeps its own
      // Enter: on an outcome chip it chooses that outcome, like any button.
      const onProblemChip = target?.closest("[data-problem-chips]") != null;
      if (!onProblemChip && (tagName === "BUTTON" || tagName === "A" || tagName === "SUMMARY")) return;
      if (!onPage) return;
      event.preventDefault();
      formRef.current?.requestSubmit();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [toggleTag, numberKeys, tags]);

  if (user.role === "clerk" && !lockedCounty) {
    return (
      <Alert tone="error" title="Your account has no county assigned.">
        A clerk can only tag filings for their own county. Ask an administrator to set the county on your account.
      </Alert>
    );
  }

  return (
    <div className={styles.columns}>
      <Card title="Tag a filing problem">
        <form ref={formRef} className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
          <ErrorSummary ref={summaryRef} errors={summary} title="This entry was not saved" />

          <div className={styles.fields}>
            {lockedCounty ? (
              <TextInput id={FIELD_IDS.county} label="County" value={lockedCounty} onChange={() => undefined} readOnly hint="Set by your account." />
            ) : (
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
            )}
            <TextInput
              id={FIELD_IDS.date}
              label="Filing date"
              type="date"
              mono
              value={date}
              onChange={(value) => {
                setDate(value);
                setErrors((current) => (current.date ? { ...current, date: undefined } : current));
              }}
              min={MIN_DATE}
              max={todayIso}
              error={errors.date}
              required
            />
            <Select id={FIELD_IDS.caseType} label="Case type" value={caseType} onChange={changeCaseType} options={CASE_TYPES} error={errors.caseType} />
            <Select
              id={FIELD_IDS.form}
              label="Form"
              value={form}
              onChange={(value) => {
                if (isForm(value)) setForm(value);
              }}
              options={formsFor(caseType)}
              error={errors.form}
            />
          </div>

          <div data-problem-chips>
            <ChipGroup
              id={FIELD_IDS.tags}
              label="What was wrong? Choose all that apply."
              hint={numberKeys ? "Keyboard: press 1 to 9 to choose problems, then Enter to save." : "Keyboard: Space chooses a problem, Enter saves."}
              error={errors.tags}
            >
              {TAGS.map((tag, index) => (
                <Chip key={tag} pressed={tags.includes(tag)} onPressedChange={() => toggleTag(tag)} shortcut={numberKeys ? String(index + 1) : undefined}>
                  {tag}
                </Chip>
              ))}
            </ChipGroup>
            {/* Always in the page, so a change made with a number key is announced. */}
            <p className="visually-hidden" role="status" aria-live="polite">
              {keyStatus}
            </p>
          </div>
          <Checkbox
            id="log-number-keys"
            label="Number-key shortcuts"
            checked={numberKeys}
            onChange={setNumberKeys}
            hint="Keys 1 to 9 choose problems while you are on this form. Turn this off if you use speech input or press keys by accident. Remembered in this browser."
          />

          <div>
            <ChipGroup
              id={FIELD_IDS.outcome}
              label="What happened to the filing?"
              hint={'"Fixed at counter" means the clerk helped the filer fix it the same day.'}
              error={errors.outcome}
            >
              {OUTCOMES.map((item) => (
                <Chip key={item} pressed={outcome === item} onPressedChange={() => setOutcome(item)} tone={OUTCOME_TONES[item]}>
                  {item}
                </Chip>
              ))}
            </ChipGroup>
          </div>

          <div className={styles.note}>
            <TextInput
              id={FIELD_IDS.note}
              label="Note"
              optional
              value={note}
              onChange={(value) => {
                markStarted();
                setNote(value);
                setErrors((current) => (current.note ? { ...current, note: undefined } : current));
              }}
              maxLength={NOTE_MAX}
              hint={`A short note about the filing, up to ${NOTE_MAX} characters. Do not include names, case numbers, addresses or phone numbers.`}
              error={errors.note}
            />
            {/* Always in the page, so the warning is announced when it appears while typing. */}
            <div aria-live="polite">
              {noteFindings.length > 0 && !errors.note ? (
                <Alert tone="warning" title={describePersonalData(noteFindings)}>
                  Found: {noteFindings.map((finding) => `"${finding.match}"`).join(", ")}. Remove it before saving.
                </Alert>
              ) : null}
            </div>
          </div>

          <div className={styles.actions}>
            <Button type="submit" variant="accent" loading={saving}>
              Save tags
            </Button>
            <Button onClick={clearEntry} disabled={saving}>
              Clear
            </Button>
          </div>
        </form>
      </Card>

      <RecentEntries version={recentVersion} canRemoveAnyTime={user.role === "admin"} onRemove={removeEntry} />
    </div>
  );
}

export function TagFiling() {
  return (
    <RoleGate
      allow={["clerk", "admin"]}
      title="Tagging is done by clerks"
      message="Court leaders can read the dashboard and the workspace, but cannot add filings."
    >
      <TagFilingForm />
    </RoleGate>
  );
}
