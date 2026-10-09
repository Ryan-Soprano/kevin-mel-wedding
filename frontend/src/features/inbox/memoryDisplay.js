const eventTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric",
  hour: "numeric", minute: "2-digit", timeZoneName: "short",
});

export function memoryTime(instant) {
  return eventTime.format(new Date(instant));
}
