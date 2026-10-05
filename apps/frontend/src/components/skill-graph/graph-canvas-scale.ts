import { createContext } from "react";

/** Screen pixels per canvas pixel. Node drag divides pointer deltas by this. */
export const GraphCanvasScaleContext = createContext(1);
