import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { UserPlus } from "lucide-react";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import { tv } from "tailwind-variants";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import Center from "@/components/ui/center";
import Flex from "@/components/ui/flex";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import organizationsService from "@/services/organizations";
import { useOrganizationContext } from "@/routes/_app.organization/organization-context";
import { formatCount } from "@/routes/_app.organization/organization-format";

interface InviteValues {
  username: string;
}

const memberLayout = tv({
  base: "grid items-start gap-4",
  variants: {
    withAside: {
      true: "lg:grid-cols-[minmax(0,1.55fr)_minmax(18rem,0.85fr)]",
      false: "grid-cols-1",
    },
  },
});

function joinedLabel(value: string | null) {
  if (!value) return "Invitation pending";
  return `Joined ${new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value))}`;
}

export default function OrganizationMembersRoute() {
  const { organization } = useOrganizationContext();
  const queryClient = useQueryClient();
  const membersQuery = useQuery({
    queryFn: () => organizationsService.members(organization.id),
    queryKey: [...organizationsService.queryKey, organization.id, "members"],
  });
  const usageQuery = useQuery({
    queryFn: () => organizationsService.usage(organization.id, { days: 30 }),
    queryKey: [...organizationsService.queryKey, organization.id, "usage", 30],
  });
  const schema = z.object({
    username: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9_-]{3,32}$/, "Enter a Hub username."),
  });
  const form = useForm<InviteValues>({
    defaultValues: { username: "" },
    resolver: zodResolver(schema),
  });
  const inviteMutation = useMutation({
    mutationFn: (username: string) =>
      organizationsService.inviteMember(organization.id, username),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: [...organizationsService.queryKey, organization.id],
      }),
  });
  const removeMutation = useMutation({
    mutationFn: (username: string) =>
      organizationsService.removeMember(organization.id, username),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: [...organizationsService.queryKey, organization.id],
      }),
  });
  const members = membersQuery.data ?? [];
  const active = members.filter((member) => member.status === "accepted");
  const pending = members.filter((member) => member.status === "pending");
  const requestsByMember = new Map<string, number>();
  for (const row of usageQuery.data?.breakdown ?? []) {
    requestsByMember.set(
      row.memberId,
      (requestsByMember.get(row.memberId) ?? 0) + row.requests,
    );
  }

  async function invite(values: InviteValues) {
    try {
      await inviteMutation.mutateAsync(values.username);
      form.reset();
    } catch (error) {
      form.setError("root", {
        message:
          error instanceof Error
            ? error.message
            : "The invitation could not be sent.",
      });
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Members
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          People with access to {organization.name}.
        </p>
      </header>

      {membersQuery.error || usageQuery.error || removeMutation.error ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {
            (membersQuery.error ?? usageQuery.error ?? removeMutation.error)
              ?.message
          }
        </p>
      ) : null}

      <div
        className={memberLayout({
          withAside: organization.role === "owner" || pending.length > 0,
        })}
      >
        <section className="min-w-0 rounded-xl border border-border bg-card shadow-xs">
          <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
            <div>
              <h2 className="font-heading text-sm font-semibold">
                Active members
              </h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Everyone currently in this organization
              </p>
            </div>
            <p className="rounded-full bg-muted px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
              {formatCount(active.length)} active
            </p>
          </header>
          {membersQuery.isPending ? (
            <p className="p-5 text-xs text-muted-foreground">Loading members…</p>
          ) : active.length ? (
            <ul className="divide-y divide-border px-4 sm:px-5">
              {active.map((member) => (
                <li
                  key={member.id}
                  className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 py-3 sm:grid-cols-[2rem_minmax(0,1fr)_auto]"
                >
                  <Center className="size-8 rounded-lg bg-muted font-mono text-[10px] font-semibold text-muted-foreground uppercase">
                    {member.username.slice(0, 2)}
                  </Center>

                  <div className="min-w-0">
                    <Flex className="flex-wrap gap-2">
                      <p className="truncate text-xs font-semibold text-foreground">
                        @{member.username}
                      </p>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] leading-tight text-muted-foreground capitalize">
                        {member.role}
                      </span>
                    </Flex>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {joinedLabel(member.joinedAt)} ·{" "}
                      <strong className="font-medium text-foreground">
                        {formatCount(requestsByMember.get(member.id) ?? 0)}
                      </strong>{" "}
                      requests in 30 days
                    </p>
                  </div>

                  <Flex className="col-start-2 flex-wrap gap-1 sm:col-start-3 sm:row-start-1">
                    <Button asChild size="sm" variant="outline">
                      <Link
                        to={`/organization/usage?member=${encodeURIComponent(member.id)}`}
                      >
                        View usage
                      </Link>
                    </Button>
                    {organization.role === "owner" &&
                    member.role !== "owner" ? (
                      <Button
                        className="text-destructive hover:text-destructive"
                        disabled={removeMutation.isPending}
                        onClick={() => removeMutation.mutate(member.username)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        Remove
                      </Button>
                    ) : null}
                  </Flex>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-5 text-xs text-muted-foreground">
              No active members are available yet.
            </p>
          )}
        </section>

        {organization.role === "owner" || pending.length > 0 ? (
          <aside className="space-y-4">
            {organization.role === "owner" ? (
              <form
                className="space-y-3 rounded-xl border border-primary/20 bg-primary/10 p-4 sm:p-5"
                onSubmit={form.handleSubmit(invite)}
              >
                <div>
                  <h2 className="font-heading text-sm font-semibold text-foreground">
                    Invite a member
                  </h2>
                  <p className="mt-1 text-muted-foreground text-xs/relaxed">
                    Invite an existing Bew Harness username to this team.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label
                    className="text-xs"
                    htmlFor="organization-invite-username"
                  >
                    Hub username
                  </Label>
                  <Input
                    id="organization-invite-username"
                    autoComplete="off"
                    aria-invalid={Boolean(form.formState.errors.username)}
                    className="h-9 bg-background"
                    placeholder="username"
                    {...form.register("username")}
                  />
                </div>

                {form.formState.errors.username ? (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.username.message}
                  </p>
                ) : null}
                {form.formState.errors.root ? (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.root.message}
                  </p>
                ) : null}

                <Button
                  className="w-full"
                  disabled={form.formState.isSubmitting}
                  size="sm"
                  type="submit"
                >
                  <UserPlus aria-hidden="true" />
                  {form.formState.isSubmitting
                    ? "Inviting…"
                    : "Send invitation"}
                </Button>
              </form>
            ) : null}

            {pending.length > 0 ? (
              <section className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
                <Flex className="justify-between gap-3">
                  <h2 className="font-heading text-sm font-semibold">
                    Pending invitations
                  </h2>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {pending.length}
                  </p>
                </Flex>

                <ul className="mt-2 divide-y divide-border">
                  {pending.map((member) => (
                    <li
                      key={member.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                    >
                      <p className="text-xs font-medium text-foreground">
                        @{member.username}
                      </p>
                      {organization.role === "owner" ? (
                        <Button
                          disabled={removeMutation.isPending}
                          onClick={() => removeMutation.mutate(member.username)}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          Cancel
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
