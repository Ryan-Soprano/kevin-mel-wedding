import { lazy, Suspense, useSyncExternalStore } from "react";
import App from "./App.jsx";

const Inbox = lazy(() => import("../features/inbox/components/Inbox.jsx"));
const SharedMemoryPage = lazy(() => import("../features/sharing/SharedMemories.jsx"));

function subscribeToLocation(notify) {
  window.addEventListener("hashchange", notify);
  window.addEventListener("popstate", notify);
  return () => { window.removeEventListener("hashchange", notify); window.removeEventListener("popstate", notify); };
}
const currentLocation = () => window.location.pathname + window.location.hash;

export default function Root({ privateArchive = false }) {
  const location = useSyncExternalStore(subscribeToLocation, currentLocation, () => "");
  const [pathname, hash = ""] = location.split("#");
  const sharedId = /^\/shared\/([0-9a-f-]{36})\/?$/i.exec(pathname)?.[1];
  if (sharedId) {
    const token = new URLSearchParams(hash).get("token") ?? undefined;
    return <Suspense fallback={<main><p role="status">Loading shared memory…</p></main>}><SharedMemoryPage key={`${sharedId}:${token ?? "public"}`} memoryId={sharedId} token={token} /></Suspense>;
  }
  return privateArchive
    ? <Suspense fallback={<main><h1>Memory inbox</h1><p role="status">Loading archive…</p></main>}><Inbox /></Suspense>
    : <App />;
}
