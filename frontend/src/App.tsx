import { Route, Routes } from "react-router-dom";

import { AppShell } from "./components/layout/AppShell";
import Applications from "./pages/Applications";
import Automations from "./pages/Automations";
import Agents from "./pages/Agents";
import Analytics from "./pages/Analytics";
import CommandCenter from "./pages/CommandCenter";
import Coms from "./pages/Coms";
import News from "./pages/News";
import Shoes from "./pages/Shoes";
import Sports from "./pages/Sports";
import SecondBrain from "./pages/SecondBrain";
import { ApplicationPage, NotFound, RedirectKeepSearch } from "./pages/stubs";
import Settings from "./pages/Settings";
import Repositories from "./pages/Repositories";
import RepositoryDetail from "./pages/RepositoryDetail";
import Tasks from "./pages/Tasks";

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<CommandCenter />} />
        <Route path="/applications" element={<Applications />} />
        <Route path="/applications/:appId/:tab" element={<ApplicationPage />} />
        <Route path="/github" element={<Analytics />} />
        <Route path="/github/repositories" element={<Repositories />} />
        <Route path="/github/repositories/:repo" element={<RepositoryDetail />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/sports" element={<Sports />} />
        <Route path="/news" element={<News />} />
        <Route path="/shoes" element={<Shoes />} />
        <Route path="/automations" element={<Automations />} />
        <Route path="/knowledge/*" element={<SecondBrain />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/second-brain" element={<RedirectKeepSearch to="/knowledge" />} />
        <Route path="/analytics" element={<RedirectKeepSearch to="/github" />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="/coms" element={<Coms />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <footer className="footer-note">
        <span>Server-side checks / private data only behind the dashboard token (usage figures, second-brain notes)</span>
        <span>AIsaac Dashboard v0.1</span>
      </footer>
    </AppShell>
  );
}
