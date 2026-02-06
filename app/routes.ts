import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("courses", "routes/courses.tsx"),
  route("api/switch-user", "routes/api.switch-user.ts"),
] satisfies RouteConfig;
