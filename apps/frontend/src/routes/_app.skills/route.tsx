import { Outlet } from "react-router";

/**
 * The `/skills` layout: purely an `<Outlet/>`. The list itself lives at the
 * `_app.skills._index` child so `/skills/:slug` (the sibling `$slug` child)
 * has somewhere to render into — a layout route with no outlet swallows
 * every child route silently, which is the bug this file exists to avoid.
 */
export default function SkillsLayoutRoute() {
  return <Outlet />;
}
