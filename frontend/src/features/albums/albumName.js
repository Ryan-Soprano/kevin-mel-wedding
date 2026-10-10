import { ApiError } from "../../shared/api/apiClient.js";

export function normalizeAlbumName(name) {
  let valid = typeof name === "string" && name.length <= 200 && Boolean(name.trim());
  for (let index = 0; valid && index < name.length; index++) {
    const code = name.charCodeAt(index);
    if (code === 0 || (code >= 0xdc00 && code <= 0xdfff)) valid = false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = name.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) valid = false;
    }
  }
  if (!valid) throw new ApiError("Give the album a name of 1–200 characters.", {
    status: 400, code: "VALIDATION_FAILED",
    fieldErrors: [{ field: "name", code: "INVALID_TEXT", message: "Give the album a name of 1–200 characters." }],
  });
  return name.trim();
}
