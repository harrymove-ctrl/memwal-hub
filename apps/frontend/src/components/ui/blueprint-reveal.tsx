import { useId, useRef } from "react";
import { motion, useInView } from "motion/react";

/**
 * A construction-drawing entrance, after the `blueprint-animation` skill
 * (github.com/moguzbulbul/blueprint-animation §2–3): a cyan wireframe of the
 * element's own rect draws in — corner ticks, a dashed outline, one dimension
 * label — then dissolves as the real content settles in behind it. The skill
 * targets a bespoke scene engine this stack doesn't have; this reimplements
 * the same palette and phase order (blueprint → construct → reveal) on
 * Framer Motion for a plain card/row entrance, once per element per mount.
 *
 * Ink `#0B8FC2`, fill `#2ACCFF14`, dashed guides `2 4` — the skill's exact
 * values (§3). Fires once, the first time the element enters the viewport.
 */
export default function BlueprintReveal({
  children,
  label,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  /** Short dimension caption, e.g. "3 SKILLS" or "FRONTEND". Uppercase mono. */
  label?: string;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const clipId = useId();

  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      {/* The wireframe layer: fades out once the content has settled in. */}
      <motion.svg
        className="pointer-events-none absolute inset-0 size-full"
        aria-hidden="true"
        initial={{ opacity: 1 }}
        animate={inView ? { opacity: 0 } : { opacity: 1 }}
        transition={{ delay: delay + 0.55, duration: 0.4, ease: "easeInOut" }}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x="0" y="0" width="100%" height="100%" rx="10" />
          </clipPath>
        </defs>
        <motion.rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          rx="10"
          fill="#2ACCFF14"
          clipPath={`url(#${clipId})`}
          initial={{ scaleY: 0 }}
          animate={inView ? { scaleY: 1 } : { scaleY: 0 }}
          transition={{ delay, duration: 0.45, ease: "easeOut" }}
          style={{ transformOrigin: "top" }}
        />
        <motion.rect
          x="1"
          y="1"
          width="calc(100% - 2px)"
          height="calc(100% - 2px)"
          rx="9"
          fill="none"
          stroke="#0B8FC2"
          strokeWidth="1"
          strokeDasharray="2 4"
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : { opacity: 0 }}
          transition={{ delay, duration: 0.5, ease: "easeInOut" }}
        />
        {/* Corner ticks, the skill's selection-handle mark (§3). */}
        <motion.g
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : { opacity: 0 }}
          transition={{ delay: delay + 0.1, duration: 0.2 }}
          stroke="#0B8FC2"
          strokeWidth="1.4"
        >
          <line x1="4" y1="4" x2="12" y2="4" />
          <line x1="4" y1="4" x2="4" y2="12" />
          <line x1="calc(100% - 4px)" y1="4" x2="calc(100% - 12px)" y2="4" />
          <line x1="calc(100% - 4px)" y1="4" x2="calc(100% - 4px)" y2="12" />
        </motion.g>
        {label ? (
          <motion.text
            x="10"
            y="18"
            fontSize="9"
            fontFamily="var(--font-mono)"
            letterSpacing="0.06em"
            fill="#0B8FC2"
            initial={{ opacity: 0 }}
            animate={inView ? { opacity: 1 } : { opacity: 0 }}
            transition={{ delay: delay + 0.2, duration: 0.25 }}
          >
            {label.toUpperCase()}
          </motion.text>
        ) : null}
      </motion.svg>

      {/* The real content, held back until the wireframe has drawn. */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={inView ? { opacity: 1 } : { opacity: 0 }}
        transition={{ delay: delay + 0.35, duration: 0.35 }}
      >
        {children}
      </motion.div>
    </div>
  );
}
