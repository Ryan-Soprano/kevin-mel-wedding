import test from "node:test";
import assert from "node:assert/strict";
import {
  getPhotoBatchCopy, getPhotoBatchSummary, getPhotoResultLabel,
  getPhotoRetryLabel, getPhotoSendLabel, getPhotoStatusText,
} from "./photoBatchDisplay.js";

test("guest confirmations name the recipient and handle one or several photos", () => {
  assert.equal(getPhotoResultLabel(true, 1, 1), "Your photo has been sent to Kevin and Melanie!");
  assert.equal(getPhotoResultLabel(true, 3, 3), "Your 3 photos have been sent to Kevin and Melanie!");
  assert.equal(getPhotoResultLabel(false, 2, 3), "2 of 3 photos sent.");
  assert.equal(getPhotoResultLabel(false, 0, 3), "0 of 3 photos sent.");
  assert.match(getPhotoBatchCopy(false).reviewDescription, /may choose to share (?:them|your photos)/);
});

test("private archive status and confirmation keep their archive meaning", () => {
  assert.equal(getPhotoStatusText({ status: "saved" }, true), "Saved privately");
  assert.equal(getPhotoResultLabel(true, 3, 3, true), "All your photos were saved privately.");
  assert.equal(getPhotoResultLabel(false, 2, 3, true), "2 of 3 photos are confirmed saved.");
  assert.equal(getPhotoBatchSummary({ retained: true, busy: false, savedCount: 2, totalCount: 3, privateArchive: true }),
    "2 of 3 photos saved privately.");
  assert.equal(getPhotoBatchSummary({ busy: true, activeItem: { status: "finalizing", fileName: "one.png" },
    savedCount: 2, totalCount: 3, privateArchive: true }), "Verifying original photo: one.png. 2 of 3 photos saved.");
});

test("guest progress changes only confirmed-photo wording and preserves recoverable statuses", () => {
  assert.equal(getPhotoStatusText({ status: "saved" }), "Sent");
  assert.equal(getPhotoStatusText({ status: "failed" }), "Needs retry");
  assert.equal(getPhotoStatusText({ status: "failed", error: { unknownOutcome: true } }), "Not confirmed");
  assert.equal(getPhotoStatusText({ status: "rejected" }), "Photo rejected");
  assert.equal(getPhotoStatusText({ status: "uploading" }), "Uploading original photo");
  assert.equal(getPhotoBatchSummary({ retained: true, busy: false, savedCount: 2, totalCount: 3 }), "2 of 3 photos sent.");
  assert.equal(getPhotoBatchSummary({ busy: true, activeItem: { status: "finalizing", fileName: "one.png" },
    savedCount: 2, totalCount: 3 }), "Verifying original photo: one.png. 2 of 3 photos sent.");
  assert.equal(getPhotoBatchSummary({ retained: false, busy: false, savedCount: 0, totalCount: 3 }), "");
});

test("sending and retry labels keep busy precedence and deliberate retry waits", () => {
  assert.equal(getPhotoSendLabel(true, 5), "Sending photos…");
  assert.equal(getPhotoRetryLabel(true, 5), "Sending photos…");
  assert.equal(getPhotoSendLabel(true, 5, true), "Saving photos…");
  assert.equal(getPhotoRetryLabel(true, 5, true), "Saving photos…");
  assert.equal(getPhotoSendLabel(false, 5), "Wait 5 seconds before sending");
  assert.equal(getPhotoRetryLabel(false, 5), "Wait 5 seconds before retrying");
  assert.equal(getPhotoSendLabel(false, 0), "Send photos");
  assert.equal(getPhotoSendLabel(false, 0, true), "Save photos privately");
  assert.equal(getPhotoRetryLabel(false, 0), "Retry selected photos");
});
