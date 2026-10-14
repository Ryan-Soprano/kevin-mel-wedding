import { createApiClient } from "./apiClient.js";
import { csrf, decodeMemory } from "./archiveContracts.js";
import { createContributionApi } from "./contributionApi.js";
import { createSessionApi } from "./sessionApi.js";
import { createMemoryApi } from "./memoryApi.js";
import { createAlbumApi } from "../../features/albums/api/albumApi.js";
import { createTimelineApi } from "../../features/timeline/api/timelineApi.js";
import { createLibraryApi } from "../../features/library/api/libraryApi.js";
import { createExportApi } from "../../features/export/api/exportApi.js";
import { createSharingApi } from "../../features/sharing/sharingApi.js";

export { decodeReceipt, normalizeMediaContribution, normalizeTextContribution } from "./archiveContracts.js";

/** Durable v1 adapter for guest memories, sessions, and private review/playback. */
export function createArchiveApi({
  client = createApiClient(), uploadFetch = globalThis.fetch, exportFetch = globalThis.fetch,
} = {}) {
  return {
    ...createAlbumApi({ client, decodeMemory, csrf }),
    ...createTimelineApi({ client, decodeMemory, csrf }),
    ...createLibraryApi({ client, decodeMemory, csrf }),
    ...createExportApi({ client, csrf, exportFetch }),
    ...createSharingApi({ client, csrf }),
    ...createContributionApi({ client, uploadFetch }),
    ...createSessionApi({ client }),
    ...createMemoryApi({ client }),
  };
}
