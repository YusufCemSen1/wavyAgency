"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";

/**
 * Money is stored and validated in integer cents everywhere. This input is the
 * only place dollars exist: it renders cents as a dollar string and converts
 * back on the way in, so the form value handed to Zod is already cents.
 */
export function MoneyInput({
  value,
  onChange,
  ...props
}: Omit<React.ComponentProps<"input">, "value" | "onChange"> & {
  value: number | undefined;
  onChange: (cents: number | undefined) => void;
}) {
  const [text, setText] = React.useState(() => centsToText(value));
  const [focused, setFocused] = React.useState(false);

  // Keep in sync when the form resets or loads existing data, but never fight
  // the user while they're typing.
  React.useEffect(() => {
    if (!focused) setText(centsToText(value));
  }, [value, focused]);

  return (
    <Input
      inputMode="decimal"
      autoComplete="off"
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        setText(centsToText(value));
      }}
      onChange={(event) => {
        const next = event.target.value;
        if (next !== "" && !/^\d*([.,]\d{0,2})?$/.test(next)) return;
        setText(next);
        onChange(textToCents(next));
      }}
      {...props}
    />
  );
}

function centsToText(cents: number | undefined): string {
  if (cents === undefined || Number.isNaN(cents)) return "";
  return (cents / 100).toFixed(2);
}

function textToCents(text: string): number | undefined {
  const normalised = text.replace(",", ".").trim();
  if (normalised === "") return undefined;
  const parsed = Number.parseFloat(normalised);
  if (Number.isNaN(parsed)) return undefined;
  return Math.round(parsed * 100);
}
