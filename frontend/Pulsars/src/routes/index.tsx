import { createBrowserRouter } from 'react-router-dom';
import App from '../App';
import HomePage from '../pages/HomePage';
import ErrorPage from '../pages/ErrorPage';
import SymptomLogPage from '../pages/SymptomLogPage';
import CheckupsPage from '../pages/CheckupsPage';
import FitnessPage from '../pages/FitnessPage';
import LoginPage from '../pages/LoginPage';
import SignOutPage from '../pages/SignOutPage';
import RequireAuth from '../components/RequireAuth';
import PatientOnly from '../components/PatientOnly';

const router = createBrowserRouter([
    {
        path: '/login',
        element: <LoginPage />,
        errorElement: <ErrorPage />,
    },
    {
        path: '/logout',
        element: <SignOutPage />,
    },
    {
        path: '/',
        element: (
            <RequireAuth>
                <App />
            </RequireAuth>
        ),
        errorElement: <ErrorPage />,
        children: [
            { path: '', element: <HomePage /> },
            { path: 'symptom-log', element: <PatientOnly><SymptomLogPage /></PatientOnly> },
            { path: 'checkups', element: <PatientOnly><CheckupsPage /></PatientOnly> },
            { path: 'fitness', element: <PatientOnly><FitnessPage /></PatientOnly> },
        ]
    }
]);

export default router;
