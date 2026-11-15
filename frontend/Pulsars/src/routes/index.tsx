import { createBrowserRouter } from 'react-router-dom';
import App from '../App';
import DashboardPage from '../pages/DashboardPage';
import ErrorPage from '../pages/ErrorPage';
import SymptomLogPage from '../pages/SymptomLogPage';
import CheckupsPage from '../pages/CheckupsPage';
import FitnessPage from '../pages/FitnessPage';

const router = createBrowserRouter([
    {
        path: '/',
        element: <App />,
        errorElement: <ErrorPage />,
        children: [
            { path: '', element: <DashboardPage /> },
            { path: 'symptom-log', element: <SymptomLogPage /> },
            { path: 'checkups', element: <CheckupsPage /> },
            { path: 'fitness', element: <FitnessPage /> },
        ]
    }
]);

export default router;
