import "@fontsource-variable/inter";
import "./app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Shell } from "./Shell";
import { Accounts } from "./screens/Accounts";
import { Approvals } from "./screens/Approvals";
import { Agents } from "./screens/Agents";
import { Analytics } from "./screens/Analytics";
import { Chat } from "./screens/Chat";
import { Home } from "./screens/Home";
import { Posts } from "./screens/Posts";

const router = createBrowserRouter([
  {
    path: "/",
    Component: Shell,
    children: [
      // The setup questions are the studio's, asked before the crew exists; the dashboard opens on
      // what they produced (`Home`), not on a form of its own.
      { index: true, Component: Home },
      { path: "chat", Component: Chat },
      { path: "posts", Component: Posts },
      { path: "analytics", Component: Analytics },
      { path: "accounts", Component: Accounts },
      { path: "approvals", Component: Approvals },
      { path: "agents", Component: Agents },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
