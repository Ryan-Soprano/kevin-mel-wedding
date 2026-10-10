// Executable v1 examples. All names, content, identifiers, tokens, and URLs are synthetic.
export const IDS = {
  contribution: "11111111-1111-4111-8111-111111111111",
  text: "22222222-2222-4222-8222-222222222222",
  photo: "33333333-3333-4333-8333-333333333333",
  secondPhoto: "44444444-4444-4444-8444-444444444444",
  clientItem: "55555555-5555-4555-8555-555555555555",
  secondClientItem: "66666666-6666-4666-8666-666666666666",
  key: "77777777-7777-4777-8777-777777777777",
  grant: "88888888-8888-4888-8888-888888888888",
  request: "99999999-9999-4999-8999-999999999999",
};
export const CREATED_AT = "2026-10-24T18:30:00.000Z";
export const CSRF_TOKEN = "synthetic-csrf-token-for-contract-preview";
export const TEXT_REQUEST = { guestName: null, message: "Wishing you a wonderful life together." };
export const PHOTO_REQUEST = {
  guestName: "Example Guest",
  memoryType: "PHOTO",
  items: [
    {
      clientItemId: IDS.clientItem,
      originalFilename: "wedding.jpg",
      declaredContentType: "image/jpeg",
      byteSize: 1024,
      checksumSha256: "a".repeat(64),
      caption: "A happy moment",
    },
    {
      clientItemId: IDS.secondClientItem,
      originalFilename: "celebration.png",
      declaredContentType: "image/png",
      byteSize: 2048,
      checksumSha256: "b".repeat(64),
      caption: null,
    },
  ],
};
export const AUDIO_REQUEST = {
  guestName: null,
  memoryType: "AUDIO",
  items: [{
    clientItemId: IDS.clientItem,
    originalFilename: "message.webm",
    declaredContentType: "audio/webm",
    byteSize: 4096,
    checksumSha256: "c".repeat(64),
    caption: null,
    durationSeconds: 12,
  }],
};
export const TEXT_RECEIPT = {
  contributionId: IDS.contribution,
  eventKey: "kevin-mel-wedding",
  createdAt: CREATED_AT,
  completion: "COMPLETE",
  memories: [{
    memoryId: IDS.text,
    clientItemId: null,
    memoryType: "TEXT",
    uploadState: null,
    reviewStatus: "PENDING",
    visibility: "COUPLE_ONLY",
  }],
};
export const PHOTO_RECEIPT = {
  ...TEXT_RECEIPT,
  completion: "PENDING",
  memories: [
    {
      memoryId: IDS.photo,
      clientItemId: IDS.clientItem,
      memoryType: "PHOTO",
      uploadState: "PENDING",
      reviewStatus: "PENDING",
      visibility: "COUPLE_ONLY",
    },
    {
      memoryId: IDS.secondPhoto,
      clientItemId: IDS.secondClientItem,
      memoryType: "PHOTO",
      uploadState: "PENDING",
      reviewStatus: "PENDING",
      visibility: "COUPLE_ONLY",
    },
  ],
};
export const PARTIAL_RECEIPT = {
  ...PHOTO_RECEIPT,
  completion: "PARTIAL",
  memories: [
    { ...PHOTO_RECEIPT.memories[0], uploadState: "UPLOADED" },
    { ...PHOTO_RECEIPT.memories[1], uploadState: "FAILED" },
  ],
};
export const MEMORY_DETAIL = {
  source: "GUEST", title: null, description: null, memoryDate: null, datePrecision: "UNKNOWN",
  memoryId: IDS.text,
  contributionId: IDS.contribution,
  guestName: null,
  memoryType: "TEXT",
  textContent: TEXT_REQUEST.message,
  caption: null,
  reviewStatus: "PENDING",
  visibility: "COUPLE_ONLY",
  revision: 1,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  deleteAfter: null,
  media: null,
};
export const MEDIA_DETAIL = {
  ...MEMORY_DETAIL,
  memoryId: IDS.photo,
  memoryType: "PHOTO",
  textContent: null,
  caption: "A happy moment",
  media: {
    originalFilename: "wedding.jpg",
    detectedContentType: "image/jpeg",
    byteSize: 1024,
    checksumSha256: "a".repeat(64),
    durationSeconds: null,
    uploadState: "UPLOADED",
  },
};
export const ANONYMOUS_SESSION = { authenticated: false, user: null, csrfToken: CSRF_TOKEN };
export const COUPLE_SESSION = {
  authenticated: true,
  user: { displayName: "Example Couple", roles: ["COUPLE"] },
  csrfToken: "synthetic-rotated-csrf-token-after-login",
};
export const INBOX_PAGE = { items: [MEMORY_DETAIL], nextCursor: null };
export const EMPTY_INBOX = { items: [], nextCursor: null };
export const UPLOAD_GRANT = {
  grantId: IDS.grant,
  method: "PUT",
  uploadUrl: "https://uploads.example.test/" + IDS.grant,
  expiresAt: "2099-10-24T18:35:00.000Z",
  headers: { "Content-Type": "image/jpeg" },
};
export const PLAYBACK = {
  url: "https://playback.example.test/" + IDS.photo,
  expiresAt: "2099-10-24T18:35:00.000Z",
};
export const VALIDATION_ERROR = {
  error: {
    code: "VALIDATION_FAILED",
    message: "Please check the highlighted fields.",
    requestId: IDS.request,
    fieldErrors: [{
      field: "message", code: "NOT_BLANK", message: "Please write a message before submitting.",
    }],
  },
};
export const SCENARIOS = [
  "success", "validation", "unauthenticated", "forbidden", "slow",
  "rateLimited", "unavailable", "networkError", "uncertainSubmission",
  "partialUpload", "expiredGrant", "invalidMedia", "playbackUnavailable", "empty",
];
