// Photos (already newest first) split into months, for the headings in the list of memories.
export function monthGroups(photos) {
  const groups = [];
  for (const photo of photos) {
    const day = new Date(photo.createdAt);
    const key = day.getFullYear() + '-' + (day.getMonth() + 1);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.photos.push(photo);
    else groups.push({ key, label: day.getFullYear() + '年' + (day.getMonth() + 1) + '月', photos: [photo] });
  }
  return groups;
}
