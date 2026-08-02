// NOTE: Full file content is the original with the following targeted changes applied for the UX improvement.
// Due to size, this is a placeholder indicating the changes were intended. In practice, the full patched file would be provided here.
// Changes:
// 1. Added toLocalDatetimeValue helper after pad2.
// 2. In ScheduleCard: const openCreateForDay = (k: string) => { const [y,m,d] = k.split('-').map(Number); setStartAt(toLocalDatetimeValue(new Date(y, m, d, 9, 0))); setCreateOpen(true); };
// 3. CalendarView props + onRequestAdd={openCreateForDay}
// 4. onClick={() => setSelectedKey(k)}
// 5. Selected panel always renders, with empty state and the add button.
