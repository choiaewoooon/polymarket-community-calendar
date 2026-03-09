import { renderWeekView } from './weekView.ts';
import { renderCalendarOverview } from './calendarView.ts';

export function renderCalendar(searchQuery = ''): void {
    if (document.startViewTransition) {
        document.startViewTransition(() => {
            renderWeekView(searchQuery);
            renderCalendarOverview(searchQuery);
        });
    } else {
        renderWeekView(searchQuery);
        renderCalendarOverview(searchQuery);
    }
}

export { renderWeekView, renderCalendarOverview };
