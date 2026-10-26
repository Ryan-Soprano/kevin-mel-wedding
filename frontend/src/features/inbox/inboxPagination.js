/** Cursor pages already discovered in this filter, including the next page. */
export function rememberInboxPages(known, selected, nextCursor) {
  const matches = selected.every((cursor, index) => known[index] === cursor);
  let pages = matches ? known : selected;
  if (nextCursor !== undefined) {
    if (nextCursor === null) pages = pages.slice(0, selected.length);
    else if (pages[selected.length] !== nextCursor) pages = [...selected, nextCursor];
  }
  return pages.length === known.length && pages.every((cursor, index) => cursor === known[index]) ? known : pages;
}

/** Keep long archives compact while retaining the first, last and nearby pages. */
export function inboxPageNumbers(count, current) {
  const numbers = new Set([1, count]);
  for (let page = Math.max(1, current - 2); page <= Math.min(count, current + 2); page++) numbers.add(page);
  return [...numbers].filter(page => page > 0).sort((a, b) => a - b).flatMap((page, index, pages) =>
    index > 0 && page - pages[index - 1] > 1 ? [`gap-${page}`, page] : [page]);
}
