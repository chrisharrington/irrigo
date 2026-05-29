import { AlertsView } from '@/components/alerts-view';

/**
 * Alerts route — the header bell's destination. Renders the full
 * `AlertsView` list. File-based route at `/alerts` (APP-79).
 */
export default function AlertsScreen() {
    return <AlertsView />;
}
