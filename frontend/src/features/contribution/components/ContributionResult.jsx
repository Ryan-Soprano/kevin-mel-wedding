import { getContributionCopy, getContributionShareLabel } from "../contributionDisplay.js";

export default function ContributionResult({ view, privateArchive, resultHeading }) {
  if (view.step === "done") {
    return (
      <section className="note-result" aria-labelledby="result-heading">
        <h2 id="result-heading" ref={resultHeading} tabIndex={-1}>You’re all set.</h2>
        <p>Your note was saved privately for Kevin and Melanie. You can close this page.</p>
      </section>
    );
  }
  const copy = getContributionCopy(privateArchive);
  return (
    <section className="note-result" aria-labelledby="result-heading">
      <h2 id="result-heading" ref={resultHeading} tabIndex={-1}>{copy.resultTitle}</h2>
      <p>{copy.resultDescription}</p>
      <div className="note-actions">
        <button type="button" className="button-secondary" onClick={view.actions.finish}>{!privateArchive && !view.hasShellActions ? "Done" : copy.finishLabel}</button>
        <button type="button" onClick={view.actions.shareAnother}>{getContributionShareLabel(view.hasShellActions)}</button>
      </div>
    </section>
  );
}
