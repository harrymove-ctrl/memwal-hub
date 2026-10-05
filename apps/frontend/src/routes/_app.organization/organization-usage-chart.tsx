import { tv } from "tailwind-variants";

import Center from "@/components/ui/center";
import Flex from "@/components/ui/flex";
import type { OrganizationUsageDay } from "@/services/organizations";

const dailyBar = tv({
  base: "w-full max-w-3 rounded-t-sm",
  variants: {
    peak: {
      true: "bg-primary",
      false: "bg-primary/40",
    },
  },
});

interface OrganizationUsageChartProps {
  days: OrganizationUsageDay[];
}

export default function OrganizationUsageChart({
  days,
}: OrganizationUsageChartProps) {
  const maximum = Math.max(1, ...days.map((day) => day.requests));

  if (days.length === 0 || days.every((day) => day.requests === 0)) {
    return (
      <Center className="min-h-32 rounded-lg border border-dashed border-border bg-muted/50 px-4">
        <p className="text-center text-xs text-muted-foreground">
          No requests recorded in this period.
        </p>
      </Center>
    );
  }

  return (
    <figure>
      <ol
        aria-label="Requests by day"
        className="relative flex h-32 items-end gap-0.5 overflow-hidden border-b border-border bg-[linear-gradient(to_bottom,transparent_24%,var(--color-border)_25%,transparent_26%,transparent_49%,var(--color-border)_50%,transparent_51%,transparent_74%,var(--color-border)_75%,transparent_76%)]"
      >
        {days.map((day) => {
          const height =
            day.requests === 0
              ? 0
              : Math.max(4, (day.requests / maximum) * 100);
          return (
            <li
              key={day.date}
              className="flex h-full min-w-0 flex-1 items-end justify-center"
              title={`${day.date}: ${day.requests} requests`}
            >
              <div
                aria-hidden="true"
                className={dailyBar({ peak: day.requests === maximum })}
                style={{ height: `${height}%` }}
              />
              <p className="sr-only">
                {day.date}: {day.requests} requests
              </p>
            </li>
          );
        })}
      </ol>
      <figcaption className="mt-2 space-y-1 text-[11px] text-muted-foreground">
        <Flex className="justify-between gap-2">
          <time dateTime={days[0]?.date}>{days[0]?.date}</time>
          <time dateTime={days.at(-1)?.date}>{days.at(-1)?.date}</time>
        </Flex>
        <details>
          <summary className="inline-flex min-h-9 cursor-pointer items-center rounded text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            Daily values
          </summary>
          <dl className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-border bg-muted p-2">
            {days.map((day) => (
              <Flex key={day.date} className="justify-between gap-4">
                <dt>
                  <time dateTime={day.date}>{day.date}</time>
                </dt>
                <dd className="font-mono text-muted-foreground">
                  {day.requests} requests
                </dd>
              </Flex>
            ))}
          </dl>
        </details>
      </figcaption>
    </figure>
  );
}
