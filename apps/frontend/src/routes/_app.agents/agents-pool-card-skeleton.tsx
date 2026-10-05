import Flex from "@/components/ui/flex";

export default function AgentsPoolCardSkeleton() {
  return (
    <li
      aria-hidden="true"
      className="relative z-10 grid items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-xs sm:grid-cols-[minmax(0,1fr)_auto]"
    >
      <div className="space-y-2">
        <div className="h-3.5 w-36 max-w-full animate-pulse rounded bg-muted" />

        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
      </div>

      <Flex className="items-center gap-2 sm:justify-end">
        <div className="h-3 w-12 animate-pulse rounded bg-muted" />

        <Flex className="-space-x-2 items-center gap-0">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="size-6 animate-pulse rounded-full bg-muted ring-2 ring-card"
            />
          ))}
        </Flex>
      </Flex>
    </li>
  );
}
