import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { normalizeMediaContribution } from "../../../shared/api/archiveApi.js";
import { getPhotoBatchFailureFocus, getPhotoBatchGuestName, getPhotoBatchSafeError, getPhotoBatchSummary } from "../photoBatchDisplay.js";

const EMPTY = {
  phase: "idle", items: [], retained: false, complete: false, pending: false,
  canStartAnother: false, retryAfterSeconds: 0, savedCount: 0, totalCount: 0,
};

export function usePhotoBatchForm({ createSubmission, active, onFlowStateChange, onDone, onShareAnother, privateArchive }) {
  const generatedId = useId();
  const prefix = `photo-batch-${generatedId}`;
  const factory = useRef(createSubmission);
  const coordinator = useRef(null);
  const mounted = useRef(false);
  const sending = useRef(false);
  const picker = useRef(null);
  const nameInput = useRef(null);
  const captionInputs = useRef(new Map());
  const result = useRef(null);
  const reviewHeading = useRef(null);
  const errorNotice = useRef(null);
  const focusRequest = useRef(null);
  const [photos, setPhotos] = useState([]);
  const [guestName, setGuestName] = useState("");
  const [snapshot, setSnapshot] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState({});
  const [selectedRetry, setSelectedRetry] = useState(new Set());
  const [batchNumber, setBatchNumber] = useState(0);
  const [step, setStep] = useState("compose");
  const [reviewData, setReviewData] = useState(null);

  useEffect(() => {
    // Effect setup creates a fresh controller after StrictMode's cleanup rehearsal.
    const current = factory.current();
    coordinator.current = current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      current.dispose();
      if (coordinator.current === current) coordinator.current = null;
    };
  }, []);

  useEffect(() => {
    if (!active || busy || !focusRequest.current) return;
    const target = focusRequest.current;
    focusRequest.current = null;
    if (target === "picker") picker.current?.focus();
    else if (target === "name") nameInput.current?.focus();
    else if (target === "result") result.current?.focus();
    else if (target === "review") reviewHeading.current?.focus();
    else if (target === "error") errorNotice.current?.focus();
    else captionInputs.current.get(target)?.focus();
  }, [active, busy, snapshot, error, photos, batchNumber, step]);

  useEffect(() => {
    const waiting = snapshot.retryAfterSeconds > 0 || snapshot.items.some(item => item.retryAfterSeconds > 0);
    if (busy || !waiting) return;
    const current = coordinator.current;
    const timer = setTimeout(() => {
      if (mounted.current && coordinator.current === current) setSnapshot(current.getSnapshot());
    }, 1000);
    return () => clearTimeout(timer);
  }, [snapshot, busy]);

  const retained = snapshot.retained || snapshot.items.length > 0;
  const locked = busy || retained || snapshot.complete || snapshot.phase === "complete";
  const savedCount = snapshot.items.filter(item => item.status === "saved").length;
  let totalCount = photos.length;
  if (retained) totalCount = snapshot.items.length;
  const globalWait = Math.max(0, Math.ceil(snapshot.retryAfterSeconds || 0));
  const byId = new Map(snapshot.items.map(item => [item.id, item]));
  const retryCandidates = snapshot.items.filter(item => item.status !== "saved" && item.terminal !== true);
  const eligible = retryCandidates.filter(item => item.retryEligible);
  const selectedEligible = eligible.filter(item => selectedRetry.has(item.id) && !(item.retryAfterSeconds > 0));
  const activeItem = snapshot.items.find(item => ["preparing", "uploading", "finalizing"].includes(item.status));
  const summary = getPhotoBatchSummary({ busy, activeItem, savedCount, totalCount, retained });
  const complete = snapshot.complete || snapshot.phase === "complete";
  const flowBusy = busy || globalWait > 0;
  const pending = retained && !complete;
  const flowComplete = complete || step === "done";
  const hasDraft = !flowComplete && (photos.length > 0 || guestName.length > 0 || retained);
  const shellActions = Boolean(onDone || onShareAnother);
  const reportFlow = useEffectEvent(state => onFlowStateChange?.(state));

  useEffect(() => {
    reportFlow({ busy: flowBusy, pending, hasDraft, complete: flowComplete });
  }, [flowBusy, pending, hasDraft, flowComplete]);

  function updateSelection(next) {
    if (locked || sending.current || step !== "compose") return;
    setPhotos(next);
    setError("");
    setFields({});
  }

  function changeCaption(id, caption) {
    if (locked || sending.current || step !== "compose") return;
    setPhotos(current => current.map(photo => {
      if (photo.id !== id) return photo;
      return { ...photo, caption };
    }));
    setFields(current => ({ ...current, [id]: undefined }));
    setError("");
  }

  function applyFailure(failure) {
    const nextFields = {};
    for (const fieldError of failure?.fieldErrors || []) {
      if (fieldError.field === "guestName") nextFields.name = fieldError.message;
      const match = fieldError.field?.match(/^items\[(\d+)\]\.caption$/);
      if (match && photos[Number(match[1])]) nextFields[photos[Number(match[1])].id] = fieldError.message;
    }
    setFields(nextFields);
    setError(getPhotoBatchSafeError(failure));
    const editable = !coordinator.current?.getSnapshot().retained;
    if (editable && failure?.code === "VALIDATION_FAILED") {
      setReviewData(null);
      setStep("compose");
    }
    focusRequest.current = getPhotoBatchFailureFocus(editable, nextFields, photos);
  }

  async function run(action) {
    const current = coordinator.current;
    if (!current || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    setFields({});
    const update = next => {
      if (mounted.current && coordinator.current === current) setSnapshot(next);
    };
    try {
      const next = await action(current, update);
      if (mounted.current && coordinator.current === current) {
        const finalSnapshot = next || current.getSnapshot();
        update(finalSnapshot);
        if (finalSnapshot.error) applyFailure(finalSnapshot.error);
        else focusRequest.current = "result";
      }
    } catch (failure) {
      if (mounted.current && coordinator.current === current) applyFailure(failure);
    } finally {
      if (mounted.current && coordinator.current === current) {
        setSnapshot(current.getSnapshot());
        sending.current = false;
        setBusy(false);
      }
    }
  }

  function review(event) {
    event.preventDefault();
    if (sending.current || retained || globalWait) return;
    if (!photos.length) {
      setError("Choose at least one photo before reviewing.");
      if (active) picker.current?.focus();
      else focusRequest.current = "picker";
      return;
    }
    try {
      // Preview validation creates no server intent, hashes or new selection identity.
      const normalized = normalizeMediaContribution({
        guestName: getPhotoBatchGuestName(privateArchive, guestName), memoryType: "PHOTO", items: photos.map(photo => ({
          clientItemId: photo.id, originalFilename: photo.file.name,
          declaredContentType: photo.file.type, byteSize: photo.file.size,
          checksumSha256: "0".repeat(64), caption: photo.caption,
        })),
      });
      setReviewData(normalized);
      setError("");
      setFields({});
      focusRequest.current = "review";
      setStep("review");
    } catch (failure) {
      applyFailure(failure);
    }
  }

  function editPhotos() {
    if (sending.current || retained || busy) return;
    setError("");
    setReviewData(null);
    focusRequest.current = "picker";
    setStep("compose");
  }

  function sendPhotos() {
    if (sending.current || retained || busy || globalWait || !reviewData || step !== "review") return;
    void run((current, update) => current.submit({ guestName: getPhotoBatchGuestName(privateArchive, guestName), photos }, update));
  }

  function retry() {
    if (globalWait || !selectedEligible.length) return;
    const ids = selectedEligible.map(item => item.id);
    void run((current, update) => current.retry(ids, update));
  }

  function resetBatch(shouldFocus = true) {
    const current = coordinator.current;
    if (sending.current || !current?.canStartAnother) return false;
    current.startAnother();
    setPhotos([]);
    setGuestName("");
    setSnapshot(current.getSnapshot());
    setSelectedRetry(new Set());
    setError("");
    setFields({});
    setBatchNumber(number => number + 1);
    setReviewData(null);
    setStep("compose");
    focusRequest.current = null;
    if (shouldFocus) focusRequest.current = "picker";
    return true;
  }

  function finish() {
    const receipt = coordinator.current?.receipt;
    if (!complete || !resetBatch(false)) return;
    if (onDone) onDone(receipt);
    else {
      focusRequest.current = "result";
      setStep("done");
    }
  }

  function shareAnother() {
    if (!complete || !resetBatch(!onShareAnother)) return;
    onShareAnother?.();
  }

  function toggleRetry(id) {
    setSelectedRetry(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function changeName(value) {
    if (locked || sending.current || step !== "compose") return;
    setGuestName(value);
    setFields(current => ({ ...current, name: undefined }));
    setError("");
  }

  function registerCaptionInput(id, node) {
    if (node) captionInputs.current.set(id, node);
    else captionInputs.current.delete(id);
  }

  return {
    picker, nameInput, result, reviewHeading, errorNotice,
    view: {
      prefix, photos, guestName, snapshot, busy, error, fields, selectedRetry, batchNumber, step, reviewData,
      retained, locked, savedCount, totalCount, globalWait, byId, retryCandidates, selectedEligible, summary, complete, shellActions,
      actions: {
        review, editPhotos, sendPhotos, retry, resetBatch, finish, shareAnother, toggleRetry,
        updateSelection, changeCaption, changeName, registerCaptionInput,
      },
    },
  };
}
