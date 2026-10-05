import { useState } from "react";
import { createMockArchiveApi } from "../shared/api/mockArchiveApi.js";
import { PHOTO_REQUEST, SCENARIOS } from "../shared/api/v1/fixtures.js";
import "./contractPreview.css";
import SinglePhotoForm from "../features/media/components/SinglePhotoForm.jsx";
import { createPhotoSubmission } from "../features/media/api/photoSubmission.js";

export default function ContractPreview() {
  const [api] = useState(() => createMockArchiveApi({ delayMs: 300 }));
  const [scenario, setScenario] = useState("success");
  const [message, setMessage] = useState("A synthetic wedding message");
  const [textKey, setTextKey] = useState(() => crypto.randomUUID());
  const [mediaKey, setMediaKey] = useState(() => crypto.randomUUID());
  const [receipt, setReceipt] = useState(null);
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState("Choose a scenario, then try an action.");

  async function run(action) {
    setBusy(true);
    try {
      const result = await action();
      setOutput(JSON.stringify(result ?? { completed: true }, null, 2));
    } catch (error) {
      setOutput(JSON.stringify({
        code: error.code ?? error.name, message: error.message,
        status: error.status, requestId: error.requestId, fieldErrors: error.fieldErrors,
        retryAfterSeconds: error.retryAfterSeconds, unknownOutcome: error.unknownOutcome,
        nextStep: error.unknownOutcome ? "Keep your draft and retry with the SAME key." : "Correct the problem and retry.",
      }, null, 2));
    } finally {
      setBusy(false);
    }
  }

  async function uploadPendingItems() {
    let current = receipt;
    const options = { idempotencyKey: mediaKey };
    for (const memory of current.memories.filter((item) => item.uploadState !== "UPLOADED")) {
      try {
        const grant = await api.authorizeUpload(current.contributionId, memory.memoryId, options);
        await api.uploadMedia(grant, new Blob(["synthetic bytes"]));
        // Transfer is not a saved confirmation. Finalization produces the receipt.
        current = await api.finalizeUpload(current.contributionId, memory.memoryId, grant.grantId, options);
        setReceipt(current);
      } catch (error) {
        setReceipt(await api.getReceipt(current.contributionId, options));
        throw error;
      }
    }
    return current;
  }

  return (
    <main>
      <h1>API v1 contract preview</h1>
      <p className="notice">Synthetic data only. No backend, database, storage, or credentials are used.
        Refreshing clears this isolated mock. Nothing here proves production readiness.</p>
      <label htmlFor="scenario">Response scenario</label>
      <select id="scenario" value={scenario} disabled={busy} onChange={(event) => {
        const value = event.target.value;
        api.setScenario(value);
        setScenario(value);
      }}>
        {SCENARIOS.map((value) => <option key={value}>{value}</option>)}
      </select>

      <section aria-labelledby="text-title">
        <h2 id="text-title">Durable text contract</h2>
        <label htmlFor="message">Draft (retained on error)</label>
        <textarea id="message" value={message} disabled={busy} onChange={(event) => setMessage(event.target.value)} />
        <p>Submit again to replay the same key. Editing the message after a successful submission
          demonstrates the changed-payload conflict.</p>
        <button disabled={busy} onClick={() => run(() => api.createTextContribution(
          { guestName: null, message }, { idempotencyKey: textKey },
        ))}>Submit / retry same draft</button>
        <button disabled={busy} onClick={() => {
          setTextKey(crypto.randomUUID());
          setOutput("A new submission key was created explicitly. Your draft is unchanged.");
        }}>Start a new submission</button>
      </section>

      <section aria-labelledby="media-title">
        <h2 id="media-title">Two-photo batch</h2>
        <p>Try partialUpload, expiredGrant, or invalidMedia. Switch to success before retrying.
          Completed items are skipped; original IDs are retained.</p>
        <button disabled={busy} onClick={() => run(async () => {
          const result = await api.createMediaContribution(PHOTO_REQUEST, { idempotencyKey: mediaKey });
          setReceipt(result);
          return result;
        })}>Create / recover batch</button>
        <button disabled={busy || !receipt} onClick={() => run(uploadPendingItems)}>Upload / retry incomplete items</button>
        <button disabled={busy} onClick={() => {
          setMediaKey(crypto.randomUUID());
          setReceipt(null);
        }}>Start a new batch</button>
        {receipt && <p role="status">Batch: {receipt.completion}. Items: {receipt.memories.map((item) => item.uploadState).join(", ")}.</p>}
      </section>

      <section aria-labelledby="inbox-title">
        <h2 id="inbox-title">Private session and inbox</h2>
        <button disabled={busy} onClick={() => run(async () => {
          const anonymous = await api.getSession();
          const loggedIn = await api.login({ username: "synthetic", password: "synthetic" }, { csrfToken: anonymous.csrfToken });
          setSession(loggedIn);
          return { authenticated: loggedIn.authenticated, user: loggedIn.user };
        })}>Synthetic sign-in</button>
        <button disabled={busy} onClick={() => run(() => api.listMemories())}>Load pending inbox</button>
        <button disabled={busy || !session} onClick={() => run(async () => {
          await api.logout({ csrfToken: session.csrfToken });
          setSession(null);
        })}>Sign out</button>
      </section>

      <h2>Last response</h2>
      <pre role="status" aria-live="polite" aria-busy={busy}>{busy ? "Waiting for the mock response…" : output}</pre>
      <h2>MED-01 single-photo form demonstration</h2>
      <p>Synthetic storage only. Choose a test photo to check progress, focus, and deliberate retry.</p>
      <SinglePhotoForm createSubmission={() => createPhotoSubmission({ api })} />
    </main>
  );
}
