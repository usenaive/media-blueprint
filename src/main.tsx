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
import { ChannelGate, Onboarding } from "./screens/Onboarding";
import { Posts } from "./screens/Posts";

const router = createBrowserRouter([
  { path: "/onboarding", Component: Onboarding },
  {
    path: "/",
    Component: Shell,
    children: [
      // Not a hard redirect to the chat any more: a channel that has not been set up has never
      // seen the screen that sets it up (`ChannelGate`).
      { index: true, Component: ChannelGate },
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
