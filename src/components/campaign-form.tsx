"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";

import { MoneyInput } from "@/components/money-input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CAMPAIGN_STATUSES, campaignInputSchema, type CampaignInput } from "@/lib/schemas";
import { PLATFORMS, PLATFORM_LABELS } from "@/lib/platforms";

export type CampaignFormValues = CampaignInput;

export function CampaignForm({
  defaultValues,
  submitLabel,
  pending,
  serverError,
  onSubmit,
}: {
  defaultValues: CampaignFormValues;
  submitLabel: string;
  pending: boolean;
  serverError?: string | null;
  onSubmit: (values: CampaignFormValues) => void;
}) {
  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CampaignFormValues>({
    // Exactly the schema the server validates against.
    resolver: zodResolver(campaignInputSchema),
    defaultValues,
  });

  const platforms = watch("platforms");

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid max-w-2xl gap-5" noValidate>
      {serverError ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t save this campaign</AlertTitle>
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      ) : null}

      <Field id="title" label="Title" error={errors.title?.message}>
        {(props) => <Input {...props} {...register("title")} placeholder="Summer sneaker drop" />}
      </Field>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Platforms</legend>
        <div className="flex flex-wrap gap-4">
          {PLATFORMS.map((platform) => {
            const checked = platforms.includes(platform);
            return (
              <Label key={platform} htmlFor={`platform-${platform}`} className="font-normal">
                <input
                  id={`platform-${platform}`}
                  type="checkbox"
                  className="size-4 accent-[var(--color-primary)]"
                  checked={checked}
                  onChange={(event) => {
                    setValue(
                      "platforms",
                      event.target.checked
                        ? [...platforms, platform]
                        : platforms.filter((value) => value !== platform),
                      { shouldValidate: true },
                    );
                  }}
                />
                {PLATFORM_LABELS[platform]}
              </Label>
            );
          })}
        </div>
        {errors.platforms ? (
          <p className="text-xs font-medium text-destructive">{errors.platforms.message}</p>
        ) : null}
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="payout"
          label="Payout per 1,000 views"
          hint="In dollars. Stored as integer cents."
          error={errors.payoutPer1kViewsCents?.message}
        >
          {(props) => (
            <Controller
              control={control}
              name="payoutPer1kViewsCents"
              render={({ field }) => (
                <MoneyInput {...props} value={field.value} onChange={field.onChange} />
              )}
            />
          )}
        </Field>

        <Field id="budget" label="Total budget" error={errors.totalBudgetCents?.message}>
          {(props) => (
            <Controller
              control={control}
              name="totalBudgetCents"
              render={({ field }) => (
                <MoneyInput {...props} value={field.value} onChange={field.onChange} />
              )}
            />
          )}
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="startsAt" label="Starts" error={errors.startsAt?.message}>
          {(props) => <Input type="date" {...props} {...register("startsAt")} />}
        </Field>
        <Field id="endsAt" label="Ends" error={errors.endsAt?.message}>
          {(props) => <Input type="date" {...props} {...register("endsAt")} />}
        </Field>
      </div>

      <Field id="status" label="Status" error={errors.status?.message}>
        {(props) => (
          <Controller
            control={control}
            name="status"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id={props.id} aria-invalid={props["aria-invalid"]}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CAMPAIGN_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        )}
      </Field>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
