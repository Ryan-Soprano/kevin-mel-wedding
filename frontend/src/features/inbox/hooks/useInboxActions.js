import { useMemo } from "react";

/** Stable adapters read the current owner only when an action is invoked. */
export function useInboxActions(controller) {
  return useMemo(() => {
    const backToInbox = () => controller.current?.backToInbox();
    const inbox = () => controller.current?.loadInbox("PENDING");
    const tags = {
      inbox,
      list: q => controller.current?.loadTags(q),
      open: id => controller.current?.openTag(id),
      beginCreate: () => controller.current?.beginTagCreation(),
      create: name => controller.current?.createTag(name),
      rename: name => controller.current?.renameTag(name),
      delete: () => controller.current?.deleteTag(),
      add: id => controller.current?.addTagMember(id),
      remove: id => controller.current?.removeTagMember(id),
      select: status => controller.current?.showTagSelector(status),
      openMemory: id => controller.current?.openTagMemory(id),
      page: next => controller.current?.tagPage(next),
      reload: refreshSession => controller.current?.reloadTagMutation({ refreshSession }),
      retry: name => controller.current?.retryTagMutation(name),
    };
    return {
      navigation: {
        back: backToInbox,
        create: () => controller.current?.beginCreation(),
        export: () => controller.current?.loadExport(),
        openMemory: id => controller.current?.openMemory(id),
        reloadInbox: (status, cursor) => controller.current?.loadInbox(status, cursor),
      },
      creation: {
        getApi: () => controller.current?.getCreationApi(),
        onDone: receipt => controller.current?.creationComplete(receipt),
        onBack: backToInbox,
      },
      metadata: {
        save: metadata => controller.current?.saveMetadata(metadata),
        reload: refreshSession => controller.current?.reloadMetadata({ refreshSession }),
        retry: () => controller.current?.retryMetadata(),
      },
      media: { retry: () => controller.current?.retryMedia() },
      review: {
        createLink: () => controller.current?.createShareLink(),
        reload: () => controller.current?.reloadReview(),
        retry: () => controller.current?.retryReview(),
        refresh: () => controller.current?.refreshReviewSession(),
      },
      albums: {
        inbox,
        list: () => controller.current?.loadAlbums(),
        open: id => controller.current?.openAlbum(id),
        beginCreate: () => controller.current?.beginAlbumCreation(),
        create: name => controller.current?.createAlbum(name),
        rename: name => controller.current?.renameAlbum(name),
        delete: () => controller.current?.deleteAlbum(),
        add: id => controller.current?.addAlbumMember(id),
        remove: id => controller.current?.removeAlbumMember(id),
        move: (id, direction) => controller.current?.moveAlbumMember(id, direction),
        select: status => controller.current?.showAlbumSelector(status),
        openMemory: id => controller.current?.openAlbumMemory(id),
        page: next => controller.current?.albumPage(next),
        reload: refreshSession => controller.current?.reloadAlbumMutation({ refreshSession }),
        retry: name => controller.current?.retryAlbumMutation(name),
      },
      timeline: {
        inbox,
        list: filters => controller.current?.loadTimeline(filters),
        open: id => controller.current?.openTimelineEvent(id),
        beginCreate: () => controller.current?.beginTimelineCreation(),
        create: fields => controller.current?.createTimelineEvent(fields),
        edit: fields => controller.current?.updateTimelineEvent(fields),
        delete: () => controller.current?.deleteTimelineEvent(),
        link: id => controller.current?.linkTimelineMemory(id),
        unlink: id => controller.current?.unlinkTimelineMemory(id),
        select: status => controller.current?.showTimelineSelector(status),
        openMemory: id => controller.current?.openTimelineMemory(id),
        page: next => controller.current?.timelinePage(next),
        reload: refreshSession => controller.current?.reloadTimelineMutation({ refreshSession }),
        retry: fields => controller.current?.retryTimelineMutation(fields),
      },
      library: {
        inbox,
        tags: () => controller.current?.loadTags(),
        list: (...args) => controller.current?.loadLibrary(...args),
        open: id => controller.current?.openLibraryMemory(id),
        choose: (...args) => controller.current?.chooseLibraryTag(...args),
        selectTag: tag => controller.current?.selectLibraryTag(tag),
        page: next => controller.current?.libraryPage(next),
      },
      tags,
      memoryTags: {
        attached: () => controller.current?.loadMemoryTags(),
        choose: q => controller.current?.chooseMemoryTag(q),
        change: (id, remove) => controller.current?.changeMemoryTag(id, remove),
        page: next => controller.current?.memoryTagPage(next),
        reload: tags.reload,
        retry: tags.retry,
      },
      export: {
        inbox,
        create: () => controller.current?.createExport(),
        check: refreshSession => controller.current?.checkExport({ refreshSession }),
        prepare: number => controller.current?.prepareExportPart(number),
        cancel: () => controller.current?.cancelExport(),
        retry: () => controller.current?.retryExportAction(),
        page: (kind, next) => controller.current?.exportPage(kind, next),
        download: () => controller.current?.downloadExportPart(),
        started: () => controller.current?.exportDownloadStarted(),
      },
    };
  }, [controller]);
}
