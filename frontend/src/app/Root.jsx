import { lazy, Suspense } from "react";
import App from "./App.jsx";

const Inbox = lazy(() => import("../features/inbox/components/Inbox.jsx"));

export default function Root({ privateArchive = false }) {
  return privateArchive
    ? <Suspense fallback={<main><h1>Memory inbox</h1><p role="status">Loading archive…</p></main>}><Inbox /></Suspense>
    : <App />;
}
