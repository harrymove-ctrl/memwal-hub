import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const STORAGE_KEY = "bew_harness_theme";

function readStoredTheme(): "light" | "dark" {
  try {
    if (typeof window === "undefined") return "light";
    return window.localStorage.getItem(STORAGE_KEY) === "dark"
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

/**
 * Sun/moon switch after uselayouts' theme-toggle: the swap rides a circular
 * view transition growing from the button, so the whole page appears to be
 * re-inked from the point you touched. Browsers without the View Transitions
 * API just switch instantly — same end state, no animation.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">(readStoredTheme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // storage unavailable: theme still applies for this session
    }
  }, [theme]);

  const toggle = (event: React.MouseEvent<HTMLButtonElement>) => {
    const next = theme === "dark" ? "light" : "dark";
    const { clientX: x, clientY: y } = event;

    if (!document.startViewTransition) {
      setTheme(next);
      return;
    }

    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );
    const transition = document.startViewTransition(() => {
      document.documentElement.classList.toggle("dark", next === "dark");
    });
    transition.ready
      .then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${radius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: 450,
            easing: "cubic-bezier(0.16, 0.84, 0.44, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      .catch(() => undefined);
    setTheme(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={
        theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
      }
      className="relative flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground active:scale-90"
    >
      <Sun
        aria-hidden="true"
        className={`absolute size-4 transition-all duration-300 ${
          theme === "dark"
            ? "scale-0 rotate-90 opacity-0"
            : "scale-100 rotate-0 opacity-100"
        }`}
      />
      <Moon
        aria-hidden="true"
        className={`absolute size-4 transition-all duration-300 ${
          theme === "dark"
            ? "scale-100 rotate-0 opacity-100"
            : "scale-0 -rotate-90 opacity-0"
        }`}
      />
    </button>
  );
}
