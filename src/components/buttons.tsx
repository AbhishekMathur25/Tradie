"use client";

/**
 * Buttons that disable themselves while their form is submitting, so a
 * double tap can't send an invoice twice.
 */
import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  className = "",
  pendingLabel = "Working…",
  name,
  value,
}: {
  children: React.ReactNode;
  className?: string;
  pendingLabel?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} name={name} value={value}>
      {pending ? pendingLabel : children}
    </button>
  );
}

/** A submit button that asks first. For actions that can't be undone. */
export function ConfirmButton({
  children,
  message,
  className = "danger",
}: {
  children: React.ReactNode;
  message: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
