import { createBrowserRouter, redirect } from "react-router-dom";

import AppLayout from "../layouts/AppLayout";
import ChatPage from "../pages/ChatPage";
import KbListPage from "../pages/KbListPage";
import LoginPage from "../pages/LoginPage";
import NewReportPage from "../pages/NewReportPage";

function requireAuthed() {
  const token = localStorage.getItem("accessToken");
  if (!token)
    throw redirect("/login");
  return null;
}

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    path: "/",
    loader: requireAuthed,
    element: <AppLayout />,
    children: [
      { index: true, loader: () => redirect("/kb") },
      { path: "kb", element: <KbListPage /> },
      { path: "chat", element: <ChatPage /> },
      { path: "reports/new", element: <NewReportPage /> },
    ],
  },
]);
