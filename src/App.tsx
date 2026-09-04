import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { FetchPage } from './pages/FetchPage';
import { MessagesPage } from './pages/MessagesPage';
import { SendersPage } from './pages/SendersPage';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/fetch" replace />} />
        <Route path="fetch" element={<FetchPage />} />
        <Route path="messages" element={<MessagesPage />} />
        <Route path="senders" element={<SendersPage />} />
        <Route path="*" element={<Navigate to="/fetch" replace />} />
      </Route>
    </Routes>
  );
}
