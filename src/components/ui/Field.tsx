// Labelled form controls. Every control gets a visible label, an optional hint, and an inline error
// that is tied to the control with aria-describedby and aria-invalid.
//
//   <TextInput label="Optional note" value={note} onChange={setNote} maxLength={200}
//              hint="Do not include names or case numbers." error={errors.note} id="log-note" />
//   <TextArea label="CSV text" value={csv} onChange={setCsv} rows={9} mono />
//   <Checkbox label="Use AI sorting" checked={useAi} onChange={setUseAi} hint="..." disabled={!ai} />
//   <Field label="Anything else" hint="..." error="...">{(control) => <input {...control} />}</Field>
//
// (Select lives in Select.tsx and uses the same Field.)
//
// onChange always receives the new VALUE, not the event. Pass `id` when an error summary needs to link
// to the control; otherwise an id is generated. `hideLabel` keeps the label for screen readers only.

"use client";

import { useId } from "react";
import type { HTMLInputTypeAttribute, ReactNode, Ref } from "react";
import { Icon } from "./Icon";
import styles from "./Field.module.css";

/** Props a Field hands to the control it wraps. Spread them on the input. */
export interface ControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

export interface FieldBaseProps {
  label: string;
  /** Help text under the label. */
  hint?: ReactNode;
  /** Error text under the control. When set, the control is marked invalid. */
  error?: string | null;
  /** Id for the control. Generated when left out. */
  id?: string;
  /** Adds "(optional)" after the label. */
  optional?: boolean;
  /** Keep the label for screen readers only. */
  hideLabel?: boolean;
  className?: string;
}

export interface FieldProps extends FieldBaseProps {
  children: (control: ControlProps) => ReactNode;
}

export function Field({ label, hint, error, id, optional, hideLabel, className, children }: FieldProps) {
  const generated = useId();
  const controlId = id ?? generated;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={[styles.field, className].filter(Boolean).join(" ")}>
      <label htmlFor={controlId} className={hideLabel ? "visually-hidden" : styles.label}>
        {label}
        {optional ? <span className={styles.optional}> (optional)</span> : null}
      </label>
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      {children({ id: controlId, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {error ? (
        <p id={errorId} className={styles.error}>
          <Icon name="alert" size={16} />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

export interface TextInputProps extends FieldBaseProps {
  value: string;
  onChange: (value: string) => void;
  /** Default "text". */
  type?: HTMLInputTypeAttribute;
  name?: string;
  placeholder?: string;
  maxLength?: number;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  autoComplete?: string;
  inputMode?: "text" | "email" | "numeric" | "search";
  /** Monospace with tabular figures, for dates and data. */
  mono?: boolean;
  onBlur?: () => void;
  ref?: Ref<HTMLInputElement>;
}

export function TextInput({
  value,
  onChange,
  type = "text",
  name,
  placeholder,
  maxLength,
  min,
  max,
  required,
  disabled,
  readOnly,
  autoComplete = "off",
  inputMode,
  mono,
  onBlur,
  ref,
  ...field
}: TextInputProps) {
  return (
    <Field {...field}>
      {(control) => (
        <input
          {...control}
          ref={ref}
          className={[styles.control, mono ? "num" : ""].filter(Boolean).join(" ")}
          type={type}
          name={name}
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          min={min}
          max={max}
          required={required}
          disabled={disabled}
          readOnly={readOnly}
          autoComplete={autoComplete}
          inputMode={inputMode}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
        />
      )}
    </Field>
  );
}

export interface TextAreaProps extends FieldBaseProps {
  value: string;
  onChange: (value: string) => void;
  /** Default 4. */
  rows?: number;
  name?: string;
  placeholder?: string;
  maxLength?: number;
  required?: boolean;
  disabled?: boolean;
  /** Monospace, for pasted data. Also turns spell check off. */
  mono?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}

export function TextArea({ value, onChange, rows = 4, name, placeholder, maxLength, required, disabled, mono, ref, ...field }: TextAreaProps) {
  return (
    <Field {...field}>
      {(control) => (
        <textarea
          {...control}
          ref={ref}
          className={[styles.control, styles.textarea, mono ? styles.mono : ""].filter(Boolean).join(" ")}
          rows={rows}
          name={name}
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          required={required}
          disabled={disabled}
          spellCheck={mono ? false : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

export interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Help text under the label. */
  hint?: ReactNode;
  disabled?: boolean;
  id?: string;
  name?: string;
}

/** A checkbox with its label to the right and an optional hint. The whole row is the click target. */
export function Checkbox({ label, checked, onChange, hint, disabled, id, name }: CheckboxProps) {
  const generated = useId();
  const controlId = id ?? generated;
  const hintId = hint ? `${controlId}-hint` : undefined;
  return (
    <div className={styles.check}>
      <input
        id={controlId}
        className={styles.box}
        type="checkbox"
        name={name}
        checked={checked}
        disabled={disabled}
        aria-describedby={hintId}
        onChange={(event) => onChange(event.target.checked)}
      />
      <div className={styles.checkText}>
        <label htmlFor={controlId} className={styles.checkLabel}>
          {label}
        </label>
        {hint ? (
          <p id={hintId} className={styles.hint}>
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
