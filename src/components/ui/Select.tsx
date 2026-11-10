// A labelled native <select>.
//
//   <Select label="County" value={county} onChange={setCounty} options={COUNTIES} />
//   <Select label="County" value={county ?? ""} onChange={(v) => setCounty(v || undefined)}
//           options={COUNTIES} placeholder="All counties" />
//   <Select label="From" value={from} onChange={setFrom}
//           options={months.map((m) => ({ value: m, label: monthLabel(m) }))} />
//
// `options` takes plain strings, or { value, label } pairs. `placeholder` adds a first option with the
// value "": the general choice a dropdown starts on ("Select case type", "Select form", "All counties").
// onChange receives the new value as a string. The browser's own arrow is used; the border is --field.
// Takes the same label, hint, error, id and hideLabel props as the other fields.

"use client";

import type { Ref } from "react";
import { Field } from "./Field";
import type { FieldBaseProps } from "./Field";
import fieldStyles from "./Field.module.css";
import styles from "./Select.module.css";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends FieldBaseProps {
  value: string;
  onChange: (value: string) => void;
  options: readonly (string | SelectOption)[];
  /** Label of an extra first option whose value is "". */
  placeholder?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  /** 36px tall on pointer devices, for dense filter bars. */
  compact?: boolean;
  ref?: Ref<HTMLSelectElement>;
}

export function Select({ value, onChange, options, placeholder, name, required, disabled, compact, ref, ...field }: SelectProps) {
  return (
    <Field {...field}>
      {(control) => (
        <select
          {...control}
          ref={ref}
          className={[fieldStyles.control, styles.select, compact ? styles.compact : ""].filter(Boolean).join(" ")}
          name={name}
          value={value}
          required={required}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
          {options.map((option) => {
            const item = typeof option === "string" ? { value: option, label: option } : option;
            return (
              <option key={item.value} value={item.value} disabled={item.disabled}>
                {item.label}
              </option>
            );
          })}
        </select>
      )}
    </Field>
  );
}
