import type { ReactNode } from "react";
import { tv } from "tailwind-variants";

const metricGrid = tv({
  base: "grid gap-px bg-border",
  variants: {
    columns: {
      3: "grid-cols-3",
      4: "grid-cols-2 lg:grid-cols-4",
    },
  },
});

interface OrganizationMetric {
  label: string;
  note?: string;
  value: string;
}

interface OrganizationMetricStripProps {
  columns: 3 | 4;
  footer?: ReactNode;
  metrics: OrganizationMetric[];
}

export default function OrganizationMetricStrip({
  columns,
  footer,
  metrics,
}: OrganizationMetricStripProps) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
      <div className={metricGrid({ columns })}>
        {metrics.map((metric) => (
          <article key={metric.label} className="min-w-0 bg-card px-4 py-3.5">
            <h2 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {metric.label}
            </h2>
            <p className="mt-1.5 font-heading text-[1.65rem] leading-none font-semibold tracking-tight text-foreground">
              {metric.value}
            </p>
            {metric.note ? (
              <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                {metric.note}
              </p>
            ) : null}
          </article>
        ))}
      </div>

      {footer ? (
        <div className="border-t border-border bg-muted px-4 py-2.5 text-[11px] text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </section>
  );
}
