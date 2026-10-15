import { useMemo } from "react";

/** Stable adapters read the current owner only when an action is invoked. */
export function useInboxActions(controller, beforeAction) {
  return useMemo(() => {
    const call = (method, ...args) => { beforeAction(); return controller.current?.[method](...args); };
    const backToInbox = () => call("backToInbox");
    const inbox = () => call("loadInbox", "PENDING");
    const tags = {
      inbox,
      list: q => call("loadTags", q),
      open: id => call("openTag", id),
      beginCreate: () => call("beginTagCreation"),
      create: name => call("createTag", name),
      rename: name => call("renameTag", name),
      delete: () => call("deleteTag"),
      add: id => call("addTagMember", id),
      remove: id => call("removeTagMember", id),
      select: status => call("showTagSelector", status),
      openMemory: id => call("openTagMemory", id),
      page: next => call("tagPage", next),
      reload: refreshSession => call("reloadTagMutation", { refreshSession }),
      retry: name => call("retryTagMutation", name),
    };
    return {
      navigation: {
        back: backToInbox,
        create: () => call("beginCreation"),
        export: () => call("loadExport"),
        openMemory: id => call("openMemory", id),
        reloadInbox: (status, cursor) => call("loadInbox", status, cursor),
      },
      creation: {
        getApi: () => call("getCreationApi"),
        onDone: receipt => call("creationComplete", receipt),
        onBack: backToInbox,
      },
      metadata: {
        save: metadata => call("saveMetadata", metadata),
        reload: refreshSession => call("reloadMetadata", { refreshSession }),
        retry: () => call("retryMetadata"),
      },
      media: { retry: () => call("retryMedia") },
      review: {
        createLink: () => call("createShareLink"),
        reload: () => call("reloadReview"),
        retry: () => call("retryReview"),
        refresh: () => call("refreshReviewSession"),
      },
      albums: {
        inbox,
        list: () => call("loadAlbums"),
        open: id => call("openAlbum", id),
        beginCreate: () => call("beginAlbumCreation"),
        create: name => call("createAlbum", name),
        rename: name => call("renameAlbum", name),
        delete: () => call("deleteAlbum"),
        add: id => call("addAlbumMember", id),
        remove: id => call("removeAlbumMember", id),
        move: (id, direction) => call("moveAlbumMember", id, direction),
        select: status => call("showAlbumSelector", status),
        openMemory: id => call("openAlbumMemory", id),
        page: next => call("albumPage", next),
        reload: refreshSession => call("reloadAlbumMutation", { refreshSession }),
        retry: name => call("retryAlbumMutation", name),
      },
      timeline: {
        inbox,
        list: filters => call("loadTimeline", filters),
        open: id => call("openTimelineEvent", id),
        beginCreate: () => call("beginTimelineCreation"),
        create: fields => call("createTimelineEvent", fields),
        edit: fields => call("updateTimelineEvent", fields),
        delete: () => call("deleteTimelineEvent"),
        link: id => call("linkTimelineMemory", id),
        unlink: id => call("unlinkTimelineMemory", id),
        select: status => call("showTimelineSelector", status),
        openMemory: id => call("openTimelineMemory", id),
        page: next => call("timelinePage", next),
        reload: refreshSession => call("reloadTimelineMutation", { refreshSession }),
        retry: fields => call("retryTimelineMutation", fields),
      },
      library: {
        inbox,
        tags: () => call("loadTags"),
        list: (...args) => call("loadLibrary", ...args),
        open: id => call("openLibraryMemory", id),
        choose: (...args) => call("chooseLibraryTag", ...args),
        selectTag: tag => call("selectLibraryTag", tag),
        page: next => call("libraryPage", next),
      },
      tags,
      memoryTags: {
        attached: () => call("loadMemoryTags"),
        choose: q => call("chooseMemoryTag", q),
        change: (id, remove) => call("changeMemoryTag", id, remove),
        page: next => call("memoryTagPage", next),
        reload: tags.reload,
        retry: tags.retry,
      },
      export: {
        inbox,
        create: () => call("createExport"),
        check: refreshSession => call("checkExport", { refreshSession }),
        prepare: number => call("prepareExportPart", number),
        cancel: () => call("cancelExport"),
        retry: () => call("retryExportAction"),
        page: (kind, next) => call("exportPage", kind, next),
        download: () => call("downloadExportPart"),
        started: () => call("exportDownloadStarted"),
      },
    };
  }, [controller, beforeAction]);
}
