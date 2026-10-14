import { createTextSubmission } from "../api/textSubmission.js";
import { useContributionForm } from "../hooks/useContributionForm.js";
import ContributionCompose from "./ContributionCompose.jsx";
import ContributionReview from "./ContributionReview.jsx";
import ContributionResult from "./ContributionResult.jsx";

export default function ContributionForm({
  active = true, onFlowStateChange, onDone, onShareAnother, createSubmission = createTextSubmission, privateArchive = false,
} = {}) {
  const { view, nameInput, messageInput, reviewHeading, resultHeading } = useContributionForm({
    active, onFlowStateChange, onDone, onShareAnother, createSubmission, privateArchive,
  });
  return (
    <div className="contribution-flow">
      {view.step === "compose" && <ContributionCompose view={view} privateArchive={privateArchive} nameInput={nameInput} messageInput={messageInput} />}
      {view.step === "review" && <ContributionReview view={view} privateArchive={privateArchive} reviewHeading={reviewHeading} />}
      {(view.step === "success" || view.step === "done") && <ContributionResult key={view.step} view={view} privateArchive={privateArchive} resultHeading={resultHeading} />}
    </div>
  );
}
